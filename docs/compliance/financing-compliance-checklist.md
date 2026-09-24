# AMANTCOM financing — compliance checklist

> **This is not legal advice.** It was written by the engineering side to prepare
> a conversation with counsel. It records what the software does today and asks
> the questions only a lawyer can answer. Every question is phrased so a lawyer
> can answer it; none of them is answered here.
>
> State: branch `gaming-store`, 2026-09-24, after financing Phases A–F.
> Sources: blueprint §10 "Important Cautions" and plan Decision 2
> (`docs/superpowers/plans/amantcom-financing.md`).

## How to read this

Each line is one of three kinds:

- **ENFORCED:** the code does this today; the file is named so it can be checked.
- **OPERATOR:** a decision, a value or a text only the business can supply.
- **COUNSEL:** a question for a lawyer. All of them are collected in §9, the
  meeting agenda.

The short version: nothing public claims a binding credit offer, approves anything
automatically, names a bank or makes a religious or legal claim. The switch that
would change that is off. What is missing is the **legal content**: consent,
privacy notice, terms, contract, retention. That content cannot be written by
engineering.

---

## 0. The switch: `FINANCING_TERMS_PUBLIC`

- **ENFORCED:** the flag defaults to `false` (`api/core/config.py:83`). While it is
  false:
  - every figure the API returns is labelled *"Estimation indicative, sous
    réserve d'acceptation du dossier."* (`api/routes/financing.py:44`, `:71-77`);
  - an approved application reads *"Accord de principe, sous réserve
    d'acceptation définitive"*, never "approuvé" or "acceptée"
    (`financing.py:58-68`).
- **ENFORCED:** the storefront cannot word this itself. `EstimateLabel` prints
  the server's label, and a test fails the build if any page renders a monthly
  figure without it (`storefront/src/__tests__/credit-copy.test.ts`).
- **OPERATOR:** flipping it to `true` changes only the labels, to *"Sous réserve
  d'acceptation du dossier."* and *"Acceptée"*. **The operator flips it, after
  the conversation this document prepares for, never engineering.**

## 1. "Do not copy QivoPay logo, product data, bank references, legal copy, religious claims, or partner claims"

- **ENFORCED:**
  - The brand is AMANTCOM's own mark, in both apps. No QivoPay asset, logo, copy or category taxonomy is used.
  - The partner page (`/partenaires`) makes no claim about benefits, commissions, partner counts, logos or response times.
- **ENFORCED:** two build-time guards scan every storefront page:
  - `credit-copy.test.ts` covers credit wording.
  - `brand-copy.test.ts` covers retired brands and delivery, price, warranty, refund and speed promises.
- **OPERATOR:** the three product photographs on the site came from the asset
  session. Confirm you hold the rights to publish them.
- **OPERATOR:** the repository's *default* demo data is still unsafe to publish:
  - `db/seed_gaming.sql` holds products derived from SteelSeries' line.
  - `db/seed_glaive_starter.sql` holds 15 invented products, loaded `ACTIVE`.
  - Both are mounted by `docker-compose.yml`. Archive them before any real order, using the SQL in the seed file's header.

## 2. "If you build a real financing product, legal/compliance review is not optional"

This document is the entry point to that review.

- **COUNSEL:** may AMANTCOM, a retailer, itself sell on instalments with a
  markup? Or must the credit be extended by a bank or an institution authorised
  by the Banque d'Algérie?
- **COUNSEL:** as we understand it, Algerian consumer-credit rules (executive
  decree 15-114 of 2015) have tied consumer credit to goods produced or
  assembled in Algeria. Does a restriction of that kind apply here, and per
  product?
- **ENGINEERING NOTE:** if the answer is yes, the rules engine cannot express it
  today. A rule applies to the whole cart and has no product, category or
  origin eligibility. That would be new work.

## 3. "Eligibility rules must be explicit and server-validated"

- **ENFORCED:**
  - Every figure is computed on the server by a pure rules engine (`api/services/financing/rules.py`), from prices the server reads. The client never sends a price (`financing.py:10-14`).
  - Money is handled as decimals in cents; no floating point touches a credit figure.
- **ENFORCED:**
  - A rule is versioned and never edited once used; a change is a new version.
  - At most one version is ACTIVE per store (`db/migrations/011_financing_core.sql:95`).
  - An application stores a snapshot of the decision and the rule it was made under. Database CHECKs restate the arithmetic, so a row whose numbers do not add up cannot be saved.
- **ENFORCED:** **no rule ships.** Until the operator activates one, the
  simulator reports financing as unavailable and the Home page shows no
  financing band.
- **ENFORCED:** a shopper is told why an estimate is not possible only in fixed,
  factual wording (`REASON_LABELS`, `financing.py:47-55`). An example is
  "L'apport est inférieur au minimum requis."
- **OPERATOR:** every business value lives in the rule the operator creates:
  - minimum and maximum amount financed;
  - minimum down payment (%);
  - maximum debt ratio (%);
  - the durations offered and the markup for each.
- **OPERATOR:** **required documents default to none.** Until the operator lists
  some, an application can be submitted with no documents at all.
- **Affordability:** the debt ratio uses the income and existing repayments the
  applicant **declares**. Nothing verifies them unless the operator requires a
  supporting document.
- **COUNSEL:** is a declared-income affordability check enough, or must income
  be evidenced?
- **COUNSEL:** which documents must be collected by law (identity, residence, income) before credit is granted?

## 4. "Avoid promises like instant approval unless the operation truly supports it"

- **ENFORCED:** **there is no automatic approval.**
  - Only a SUPER_ADMIN or ADMIN can approve, reject or mark signed, one application at a time (`api/routes/financing_review.py:20-24`, approve at `:404`).
  - Approval is refused until every uploaded document has been reviewed and
    every required document type has an accepted file
    (`financing_review.py:354`).
- **ENFORCED:** no status reads as approved while the switch is off (§0).
- **ENFORCED:** a test fails the build on any speed promise in the storefront:
  "instantané", "immédiat", "en quelques minutes", "réponse rapide". Another fails it on "approuv".
- **OPERATOR:** a refused applicant sees only *"Non retenue"*. The reason
  recorded by the reviewer is internal. Is that what you want to tell them?
- **COUNSEL:** must a refused applicant be given the reason?
- **COUNSEL:** must decisions be communicated in writing, and within a set time?

## 5. "Product monthly price must be calculated from verified business rules, not hardcoded visually"

- **ENFORCED:** the monthly amount exists only as an API response. The storefront
  build fails if its code contains "DA/mois", "par mois", "mensualité" or "à
  partir de", or renders a monthly figure without the server's label.
- **ENFORCED:** product cards and listings show the cash price only. A monthly
  figure appears in just four places, always under the server's label:
  - the simulator (on `/simulate` and on a product page);
  - the application summary;
  - the customer's own applications.

  With no active rule, the simulator does not offer financing at all.
- **ENFORCED:** every estimate shown is recorded with the rule version that produced
  it (`financing_simulations`, `011_financing_core.sql:140-160`). The record is anonymous: cart lines and
  the decision, no personal data. It answers "which figure did a shopper see,
  and under which terms?"
- **How the price is built:** a flat markup per duration on the financed amount.
  It is split into equal monthly amounts, with any remainder spread over the
  first months. **No interest rate or APR is computed or shown.**
- **COUNSEL:** must the offer show an annual rate (TEG/APR) or the total cost of
  credit? Is a markup presentation acceptable?
- **COUNSEL:** what must the pre-contract information show, and when?
- **COUNSEL:** if the offer is ever presented as Islamic-compliant (murabaha),
  that is a religious claim; see §6.

## 6. "Bank/religious/legal claims require formal approval before publication"

- **ENFORCED:** none is published. No bank is named. No sharia or religious
  claim is made. No legal page exists: there are no terms of sale, privacy
  policy, legal notice or credit terms. They were left out on purpose rather than
  filled with plausible text. The footer links to none of them.
- **OPERATOR:** documents to supply before launch, each approved by counsel:
  - terms of sale (CGV) and terms of use;
  - the privacy notice (see §7);
  - the legal notice, with the company's identity (legal name, RC, NIF, address);
  - the credit contract template, and the pre-contract information sheet;
  - any partner bank's name: only with that bank's written approval;
  - any religious-compliance wording: only with the certificate it relies on.
- **OPERATOR:** *"TVA incluse"* appears on every product page
  (`storefront/src/pages/ProductDetail.tsx:386`). It is a fiscal statement.
  Confirm it with your accountant, or remove it.
- **OPERATOR:** a contract is marked "signed" by an admin, with an optional
  fingerprint (SHA-256) of the signed file. There is no electronic signature.
- **COUNSEL:** is a paper signature, recorded like this, enough?

## 7. Personal data (Law 18-07)

The plan deferred this question to Phase F. The answer: the data is well protected,
but **consent, notice and retention do not exist yet**.

### What is collected

| Data | Where it is stored | Why |
|---|---|---|
| Name, phone, e-mail | `customers` (`db/schema.sql:180`) | Orders and sign-in |
| Sign-in code | bcrypt hash only; the requester's IP as a keyed hash (010:57-66) | Throttling. Plaintext codes are never stored or logged outside development. |
| Session | SHA-256 of the token (010:110) | Staying signed in |
| Delivery address (wilaya, commune, street) | `orders.shipping_address` (schema) | Delivery (existed before financing) |
| Monthly income, existing repayments, dependents | `financial_profiles` (013:110) | Affordability |
| Employment type, employer, job title, start date | `employment_profiles` (013:128) | Affordability |
| Uploaded documents (PDF/JPEG/PNG/WebP) | Private R2 bucket; type checked from content; SHA-256 (013:209-222) | The operator's required documents |
| Every status change, with the admin who made it | `application_status_events` | Audit trail |
| Partner applicant: shop, contact, phone, address | `partner_applications` (014) | Partner onboarding |

### How it is protected (ENFORCED)

- Every row belongs to one store; asking for another store's row returns
  "not found".
- Who can see what (`api/routes/financing_review.py:20-24`):
  - VIEWER sees the queue only; it cannot open files.
  - OPERATOR can open and review documents.
  - ADMIN and SUPER_ADMIN make decisions.
- Documents are never given out by link. They stream through the API as downloads,
  and each read is logged with the admin's id.
  - **Limit:** that log is the application log, not a database table. It lasts
    only as long as the hosting platform keeps logs, unless a log drain is set
    up.
- Fail closed:
  - With no SMS provider configured, sign-in answers "unavailable" (503) rather than showing a code.
  - With no private document bucket, uploads answer "unavailable" (503).
  - Pointing documents at the public media bucket is refused (`api/services/documents/__init__.py:84-95`).

### What is missing (open)

- **Consent:** the application form collects income and employment data with
  no consent text and no checkbox. There is also nowhere to record which
  version of the text a person accepted, or when. **Both the words and the
  mechanism are missing.** The words are the operator's, with counsel. Recording
  consent is a small engineering task once the words exist.
- **Privacy notice:** none.
- **Retention: undefined.** Nothing is deleted automatically, including refused applications and their documents.
  Worse, the database forbids deleting an application at all: its profiles and
  documents are linked with `ON DELETE RESTRICT`, and there is no anonymisation
  path. Whatever period counsel sets, a deletion or anonymisation job has to be
  built to honour it.
- **People's rights** (access, correction, deletion): there is no self-service. Today each
  request would be manual database work.
- **Hosting location:** the database is on Neon and documents on Cloudflare R2.
  Their regions have to be confirmed.

## 8. Before launch (not legal questions, but they block)

- [ ] Apply migrations 010–014 to a Neon **branch** first. They have never run
      against a real database, and their trigger bodies are unverified.
- [ ] Choose and configure an SMS provider. Sign-in does not work without one.
- [ ] Create a private R2 bucket for documents.
- [ ] Create and activate a financing rule, and decide the required documents.
- [ ] Rotate the seeded admin password (`db/seed_admin.sql`).
- [ ] Archive the demo catalog (§1).
- [ ] Decide whether El Yusr and AMANTCOM are the same product; that decides
      how stores are set up.
- [ ] Run the signed-in flows (sign-in, apply, upload, review) end to end
      against the live API. They have only been tested without one.
- [ ] Only then, after counsel: consider `FINANCING_TERMS_PUBLIC=true`.

## 9. Questions for counsel (the meeting agenda)

1. May a retailer sell on instalments with a markup? Or must the credit come
   from a bank or an institution authorised by the Banque d'Algérie?
2. Do consumer-credit rules limit which goods may be financed (e.g. local
   production)? If so, per product or per category?
3. Must the offer show an annual rate or total cost of credit? Is a flat
   markup per duration an acceptable way to present the price?
4. What pre-contract information must the customer receive, and when?
5. Is a declared-income affordability check enough, or must income be
   evidenced? Which documents must be collected by law?
6. Must a refused applicant be given the reason, in writing, within a set time?
7. Is a paper signature recorded by an admin enough, or is an electronic
   signature required?
8. Does processing this data require a declaration to, or authorisation from, the national
   personal-data authority (ANPDP) under Law 18-07?
9. What must the consent text say? Must consent be separate for the credit
   check and for the order?
10. How long must, or may, identity documents, income data and **refused**
    applications be kept?
11. Is hosting the database or documents outside Algeria a transfer abroad
    that needs authorisation?
12. Is "TVA incluse" correct as stated on every product page?
13. If the offer is to be called Islamic-compliant, what certification is
    needed before saying so?

## 10. Decisions record

Fill in during or after the meeting; engineering works from this table.

| # | Question | Answer | Decided by | Date |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
