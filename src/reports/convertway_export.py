"""Exports a customer segment into ConvertWay's upload CSV format
(phone, email, first name, last name, country code -- exact header order,
per the sample file supplied).

Not full automation on purpose (per the original request): this produces
the file for a human to review and upload to ConvertWay themselves, rather
than pushing to ConvertWay's own API directly.
"""

import csv

import phonenumbers

FIELDNAMES = ["phone", "email", "first name", "last name", "country code"]


def _split_phone(raw_phone: str) -> tuple[str, str] | None:
    """Splits a combined phone string (e.g. '+919050111111') into
    (national_number, country_code). Returns None if it can't be parsed as
    a valid number -- phonenumbers handles the actual parsing/validation
    rather than us guessing country code length by hand."""
    try:
        parsed = phonenumbers.parse(raw_phone, None)
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(parsed):
        return None
    return str(parsed.national_number), str(parsed.country_code)


def export_customers_to_csv(customers: list[dict], output_path: str) -> dict:
    """customers: list of dicts with email/phone/first_name/last_name keys.
    Returns counts -- never silently drops a customer without reporting why."""
    exported = 0
    skipped_no_phone = 0
    skipped_invalid_phone = 0

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()

        for c in customers:
            raw_phone = c.get("phone")
            if not raw_phone:
                skipped_no_phone += 1
                continue

            split = _split_phone(raw_phone)
            if split is None:
                skipped_invalid_phone += 1
                continue
            national_number, country_code = split

            writer.writerow({
                "phone": national_number,
                "email": c.get("email") or "",
                "first name": c.get("first_name") or "",
                "last name": c.get("last_name") or "",
                "country code": country_code,
            })
            exported += 1

    return {
        "exported": exported,
        "skipped_no_phone": skipped_no_phone,
        "skipped_invalid_phone": skipped_invalid_phone,
    }
