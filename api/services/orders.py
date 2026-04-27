from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import get_settings
from api.models.schemas import OrderCreate
from api.services.events import emit_event

_settings = get_settings()


def _normalize_phone(raw: str) -> str:
    return "".join(ch for ch in raw if ch.isdigit())


async def _upsert_customer(db: AsyncSession, dto: OrderCreate) -> UUID:
    norm = _normalize_phone(dto.customer_phone)
    row = await db.execute(
        text("SELECT id FROM customers WHERE phone_normalized = :p"),
        {"p": norm},
    )
    existing = row.first()
    if existing:
        return existing[0]
    new_id = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO customers (id, phone, phone_normalized, full_name, email)
            VALUES (:id, :phone, :norm, :name, :email)
            """
        ),
        {
            "id": new_id,
            "phone": dto.customer_phone,
            "norm": norm,
            "name": dto.customer_name,
            "email": str(dto.customer_email) if dto.customer_email else None,
        },
    )
    return new_id


async def _next_order_number(db: AsyncSession) -> str:
    year = datetime.now(timezone.utc).year
    row = await db.execute(
        text(
            "SELECT COALESCE(MAX(CAST(SPLIT_PART(order_number,'-',3) AS INTEGER)),0)+1 "
            "FROM orders WHERE order_number LIKE :prefix"
        ),
        {"prefix": f"GL-{year}-%"},
    )
    n = row.scalar_one()
    return f"GL-{year}-{n:06d}"


async def create_order(db: AsyncSession, dto: OrderCreate) -> dict:
    # idempotency: same key returns the existing order
    if dto.idempotency_key:
        row = await db.execute(
            text("SELECT id FROM orders WHERE idempotency_key = :k"),
            {"k": dto.idempotency_key},
        )
        existing = row.first()
        if existing:
            return await fetch_order(db, existing[0])

    customer_id = await _upsert_customer(db, dto)
    order_id = uuid4()
    order_number = await _next_order_number(db)

    # Load all relevant offers in a single query + row-lock them to avoid races
    offer_ids = [i.offer_id for i in dto.items]
    offers_rows = await db.execute(
        text(
            """
            SELECT o.id, o.product_id, o.variant_sku,
                   COALESCE(o.sale_price, o.retail_price) AS unit_price,
                   o.currency, o.is_active, p.name AS product_name
              FROM offers o
              JOIN products p ON p.id = o.product_id
             WHERE o.id = ANY(:ids)
             FOR UPDATE OF o
            """
        ),
        {"ids": offer_ids},
    )
    offers = {r[0]: r for r in offers_rows.all()}
    missing = [str(i) for i in offer_ids if i not in offers]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"offers not found: {missing}")
    for oid, o in offers.items():
        if not o[5]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"offer {oid} is inactive")

    # Insert order shell
    subtotal = Decimal("0")
    created_items: list[tuple[UUID, UUID, UUID, str, str, Decimal, int, Decimal]] = []
    for item in dto.items:
        o = offers[item.offer_id]
        unit_price = Decimal(str(o[3]))
        qty = item.quantity
        line_total = (unit_price * qty).quantize(Decimal("0.01"))
        subtotal += line_total
        created_items.append(
            (uuid4(), item.offer_id, o[1], o[6], o[2], unit_price, qty, line_total)
        )

    total = (subtotal + dto.shipping_cost - dto.discount_amount).quantize(Decimal("0.01"))
    if total < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "total cannot be negative")

    await db.execute(
        text(
            """
            INSERT INTO orders (
                id, order_number, customer_id, status, payment_status, payment_method,
                subtotal, shipping_cost, discount_amount, tax_amount, total, currency,
                shipping_address, notes, idempotency_key
            ) VALUES (
                :id, :num, :cust, 'PENDING', 'UNPAID', :pm,
                :sub, :ship, :disc, 0, :tot, 'DZD',
                CAST(:addr AS JSONB), :notes, :idemp
            )
            """
        ),
        {
            "id": order_id,
            "num": order_number,
            "cust": customer_id,
            "pm": dto.payment_method,
            "sub": subtotal,
            "ship": dto.shipping_cost,
            "disc": dto.discount_amount,
            "tot": total,
            "addr": dto.shipping_address.model_dump_json(),
            "notes": dto.notes,
            "idemp": dto.idempotency_key,
        },
    )

    # Insert line items + reserve stock atomically via fn_reserve_stock
    for (item_id, offer_id, product_id, product_name, variant_sku,
         unit_price, qty, line_total) in created_items:
        await db.execute(
            text(
                """
                INSERT INTO order_items (
                    id, order_id, offer_id, product_id,
                    product_name, variant_sku, unit_price, quantity, line_total, currency
                ) VALUES (
                    :id, :order, :offer, :prod,
                    :name, :sku, :price, :qty, :total, 'DZD'
                )
                """
            ),
            {
                "id": item_id, "order": order_id, "offer": offer_id, "prod": product_id,
                "name": product_name, "sku": variant_sku,
                "price": unit_price, "qty": qty, "total": line_total,
            },
        )
        await db.execute(
            text("SELECT fn_reserve_stock(:offer, :order, :item, :qty, :ttl)"),
            {
                "offer": offer_id, "order": order_id, "item": item_id,
                "qty": qty, "ttl": _settings.reservation_ttl_minutes,
            },
        )

    # Move order to RESERVED
    await db.execute(
        text("UPDATE orders SET status = 'RESERVED' WHERE id = :id"),
        {"id": order_id},
    )

    await emit_event(
        db,
        event_type="order.created",
        entity_type="order",
        entity_id=order_id,
        payload={"order_number": order_number, "total": str(total)},
        correlation_id=order_id,
    )
    return await fetch_order(db, order_id)


async def confirm_order(db: AsyncSession, order_id: UUID) -> dict:
    row = await db.execute(
        text("SELECT status FROM orders WHERE id = :id FOR UPDATE"),
        {"id": order_id},
    )
    cur = row.first()
    if not cur:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "order not found")
    if cur[0] != "RESERVED":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"cannot confirm order in status {cur[0]}",
        )

    res_rows = await db.execute(
        text(
            "SELECT id FROM inventory_reservations "
            "WHERE order_id = :o AND status = 'ACTIVE' FOR UPDATE"
        ),
        {"o": order_id},
    )
    for (rid,) in res_rows.all():
        await db.execute(text("SELECT fn_consume_reservation(:r)"), {"r": rid})

    await db.execute(
        text(
            "UPDATE orders SET status = 'CONFIRMED', confirmed_at = NOW() "
            "WHERE id = :id"
        ),
        {"id": order_id},
    )

    await emit_event(
        db, event_type="order.confirmed", entity_type="order",
        entity_id=order_id, correlation_id=order_id,
    )
    return await fetch_order(db, order_id)


async def cancel_order(db: AsyncSession, order_id: UUID, reason: str | None) -> dict:
    row = await db.execute(
        text("SELECT status FROM orders WHERE id = :id FOR UPDATE"),
        {"id": order_id},
    )
    cur = row.first()
    if not cur:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "order not found")
    if cur[0] in ("DELIVERED", "CANCELLED", "RETURNED"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"cannot cancel order in status {cur[0]}",
        )

    res_rows = await db.execute(
        text(
            "SELECT id FROM inventory_reservations "
            "WHERE order_id = :o AND status = 'ACTIVE' FOR UPDATE"
        ),
        {"o": order_id},
    )
    for (rid,) in res_rows.all():
        await db.execute(text("SELECT fn_release_reservation(:r)"), {"r": rid})

    await db.execute(
        text(
            "UPDATE orders SET status = 'CANCELLED', cancelled_at = NOW(), "
            "cancellation_reason = :r WHERE id = :id"
        ),
        {"id": order_id, "r": reason},
    )
    await emit_event(
        db, event_type="order.cancelled", entity_type="order",
        entity_id=order_id, payload={"reason": reason}, correlation_id=order_id,
    )
    return await fetch_order(db, order_id)


async def fetch_order(db: AsyncSession, order_id: UUID) -> dict:
    order_row = await db.execute(
        text(
            """
            SELECT id, order_number, status, payment_status, payment_method,
                   subtotal, shipping_cost, discount_amount, tax_amount, total,
                   currency, created_at
              FROM orders WHERE id = :id
            """
        ),
        {"id": order_id},
    )
    o = order_row.first()
    if not o:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "order not found")

    items_rows = await db.execute(
        text(
            """
            SELECT id, offer_id, product_id, product_name, variant_sku,
                   unit_price, quantity, line_total
              FROM order_items WHERE order_id = :id
            """
        ),
        {"id": order_id},
    )
    items = [
        {
            "id": r[0], "offer_id": r[1], "product_id": r[2],
            "product_name": r[3], "variant_sku": r[4],
            "unit_price": r[5], "quantity": r[6], "line_total": r[7],
        }
        for r in items_rows.all()
    ]
    return {
        "id": o[0], "order_number": o[1], "status": o[2],
        "payment_status": o[3], "payment_method": o[4],
        "subtotal": o[5], "shipping_cost": o[6], "discount_amount": o[7],
        "tax_amount": o[8], "total": o[9], "currency": o[10],
        "created_at": o[11], "items": items,
    }
