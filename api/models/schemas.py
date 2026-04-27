from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


# ===== Products =====

class ProductBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sku: str = Field(min_length=1, max_length=120)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=500)
    brand: str | None = None
    model: str | None = None
    category: str | None = None
    subcategory: str | None = None
    description: str | None = None
    specs: dict[str, Any] = Field(default_factory=dict)
    barcode: str | None = None
    mpn: str | None = None
    ean: str | None = None


class ProductCreate(ProductBase):
    """Initial offer is optional but recommended (can be added later)."""
    initial_offer: "OfferCreate | None" = None


class ProductPatch(BaseModel):
    """All fields optional — only sent fields are updated."""
    model_config = ConfigDict(from_attributes=True)

    sku: str | None = Field(default=None, min_length=1, max_length=120)
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str | None = Field(default=None, min_length=1, max_length=500)
    brand: str | None = None
    model: str | None = None
    category: str | None = None
    subcategory: str | None = None
    description: str | None = None
    specs: dict[str, Any] | None = None
    barcode: str | None = None
    mpn: str | None = None
    ean: str | None = None
    status: Literal["RAW", "NORMALIZED", "CLASSIFIED", "VERIFIED", "ACTIVE", "NEEDS_FIX", "ARCHIVED"] | None = None


class ProductOut(ProductBase):
    id: UUID
    status: str
    completeness_score: float
    created_at: datetime
    updated_at: datetime
    version: int


# ===== Offers =====

class OfferBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    variant_sku: str = Field(min_length=1, max_length=120)
    variant_attrs: dict[str, Any] = Field(default_factory=dict)
    purchase_price: Decimal = Field(ge=0)
    retail_price: Decimal = Field(ge=0)
    sale_price: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="DZD", min_length=3, max_length=3)
    stock_quantity: int = Field(default=0, ge=0)
    low_stock_threshold: int = Field(default=5, ge=0)


class OfferCreate(OfferBase):
    pass


class OfferPatch(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    variant_sku: str | None = Field(default=None, min_length=1, max_length=120)
    variant_attrs: dict[str, Any] | None = None
    purchase_price: Decimal | None = Field(default=None, ge=0)
    retail_price: Decimal | None = Field(default=None, ge=0)
    sale_price: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    stock_quantity: int | None = Field(default=None, ge=0)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class OfferOut(OfferBase):
    id: UUID
    product_id: UUID
    reserved_quantity: int
    is_active: bool


# ===== Orders =====

class OrderItemIn(BaseModel):
    offer_id: UUID
    quantity: int = Field(gt=0, le=10_000)


class ShippingAddress(BaseModel):
    wilaya: str
    commune: str
    street: str
    notes: str | None = None


class OrderCreate(BaseModel):
    customer_phone: str = Field(min_length=6, max_length=30)
    customer_name: str = Field(min_length=1, max_length=200)
    customer_email: EmailStr | None = None
    items: list[OrderItemIn] = Field(min_length=1, max_length=100)
    shipping_address: ShippingAddress
    payment_method: Literal["COD", "CARD", "BANK_TRANSFER", "WALLET"] = "COD"
    shipping_cost: Decimal = Field(default=Decimal("0"), ge=0)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    notes: str | None = None
    idempotency_key: str | None = Field(default=None, max_length=120)

    @field_validator("customer_phone")
    @classmethod
    def _phone_digits(cls, v: str) -> str:
        stripped = "".join(ch for ch in v if ch.isdigit() or ch == "+")
        if len(stripped) < 6:
            raise ValueError("phone too short")
        return stripped


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    offer_id: UUID
    product_id: UUID
    product_name: str
    variant_sku: str
    unit_price: Decimal
    quantity: int
    line_total: Decimal


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    order_number: str
    status: str
    payment_status: str
    payment_method: str
    subtotal: Decimal
    shipping_cost: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total: Decimal
    currency: str
    items: list[OrderItemOut]
    created_at: datetime


# ===== Events =====

class EventIn(BaseModel):
    event_id: UUID
    event_type: str = Field(min_length=1, max_length=120)
    entity_type: str = Field(min_length=1, max_length=50)
    entity_id: UUID | None = None
    correlation_id: UUID | None = None
    causation_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


# ===== Auth =====

class AdminLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
