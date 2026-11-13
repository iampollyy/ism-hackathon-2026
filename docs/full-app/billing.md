# Pricing and plans (demo mode)

Written for the front end. **No payment is ever taken and the app never asks for card details**: choosing a plan only records it, and every
plan answer carries `demo: true`. Show the `demo_note` near any "choose" button.

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/api/pricing` | | `{trial_days: 30, currency: "EUR", plans: [PricePlan], demo_note}` |
| GET | `/api/families/{id}/plan` | | `FamilyPlanView` |
| POST | `/api/families/{id}/plan` | `{plan: "family_monthly" \| "family_yearly" \| "bank", bank_code?}` | `FamilyPlanView` |
| POST | `/api/families/{id}/plan/cancel` | | `FamilyPlanView` (status `canceled`) |

`PricePlan`: `{key, name, price, price_eur, period, note, features: [string], cta, choosable}`. Keys, in order: `family_monthly` (€4.99 a
month), `family_yearly` (€49 a year), `bank` (free with a partner-bank code), `partner` (for banks, "Talk to us"; `choosable: false`, so link to
a contact action instead of choosing).

`FamilyPlanView`: `{plan: "trial" | "family_monthly" | "family_yearly" | "bank", plan_name, status: "trialing" | "active" | "canceled", price,
trial_ends_at, started_at, bank_code, demo: true}`. A family without a choice is on a 30-day trial from sign-up; nothing is blocked when it ends.

Errors: 404 `not_found` (no family), 422 `invalid_bank_code` (bank plan without a 4–40 character code of letters, digits or dashes),
422 `invalid_request` (unknown plan key), 409 `no_plan` (cancel while on the trial).

Where to show it: a public pricing page (`/pricing`), a "Choose your plan" step at the end of sign-up (skippable: "Start the free trial"), and a
"Plan and billing" section in the organiser's settings.
