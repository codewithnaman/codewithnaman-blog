---
title: 'PCI Compliance Checklist for Engineers'
description: 'A practical checklist for building PCI-DSS compliant payment systems.'
pubDate: 2026-03-28
author: 'jane-doe'
tags: [fintech, pci, compliance, security]
categories: [FinTech, Security]
draft: false
toc: true
---

PCI DSS (Payment Card Industry Data Security Standard) is the security framework that every organization handling card data must follow. As an engineer, you don't need to memorize all 250+ requirements — but you do need to understand the ones that affect your code.

Here's a practical checklist for building PCI-compliant systems, from a developer's perspective.

## Scope Reduction: The Most Important Principle

The single best thing you can do for PCI compliance is **reduce the scope** — minimize the number of systems that touch card data. Every system in scope requires audits, monitoring, and security controls.

### Use Tokenization

Never store raw card numbers. Use a payment processor's tokenization service:

```python
import stripe

# BAD: Storing card numbers
def store_card(customer_id: str, card_number: str):
    db.execute("""
        INSERT INTO customer_cards (customer_id, card_number)
        VALUES ($1, $2)
    """, customer_id, card_number)  # NEVER DO THIS

# GOOD: Using Stripe tokens
def tokenize_card(card_number: str, exp_month: int, exp_year: int):
    token = stripe.Token.create(
        card={
            "number": card_number,
            "exp_month": exp_month,
            "exp_year": exp_year,
        }
    )
    return token.id  # tok_1234 — safe to store

def charge_customer(customer_id: str, amount: int):
    card_token = db.fetch(
        "SELECT stripe_token FROM customers WHERE id = $1",
        customer_id
    )

    stripe.Charge.create(
        amount=amount,
        currency="usd",
        source=card_token,  # Token, not card number
    )
```

With tokenization, card data goes directly from the customer's browser to Stripe. Your servers never see it, which dramatically reduces your PCI scope.

### Use Hosted Payment Fields

For web forms, use the payment processor's hosted fields or Elements:

```html
<!-- Card data goes directly to Stripe, never touches your server -->
<script src="https://js.stripe.com/v3/"></script>
<form id="payment-form">
  <div id="card-element">
    <!-- Stripe Elements inserts the card input here -->
  </div>
  <button type="submit">Pay</button>
</form>

<script>
  const stripe = Stripe('pk_live_...');
  const elements = stripe.elements();
  const card = elements.create('card');
  card.mount('#card-element');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { paymentMethod, error } = await stripe.createPaymentMethod({
      type: 'card',
      card: card,
    });
    // Send paymentMethod.id to your server — no card data
  });
</script>
```

## Encryption Requirements

When card data must transit through your systems (even briefly), it must be encrypted:

### In Transit

```nginx
# nginx configuration for PCI-compliant TLS
server {
    listen 443 ssl http2;

    ssl_certificate /etc/ssl/certs/server.crt;
    ssl_certificate_key /etc/ssl/private/server.key;

    # TLS 1.2+ only
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;
}
```

### At Rest

```python
from cryptography.fernet import Fernet

# Encrypt sensitive fields before storing
class EncryptedField:
    def __init__(self, key: bytes):
        self.fernet = Fernet(key)

    def encrypt(self, value: str) -> str:
        return self.fernet.encrypt(value.encode()).decode()

    def decrypt(self, encrypted: str) -> str:
        return self.fernet.decrypt(encrypted.encode()).decode()

# Key management: never hardcode encryption keys
# Use AWS KMS, HashiCorp Vault, or similar
```

## Access Control

PCI DSS requires strict access control for systems handling card data:

```python
from functools import wraps

def require_pci_access(role: str):
    """Decorator to enforce role-based access for PCI-scoped systems."""
    def decorator(func):
        @wraps(func)
        def wrapper(request, *args, **kwargs):
            if not request.user.has_role(role):
                raise PermissionDenied(
                    "PCI-scoped data requires elevated access"
                )

            # Log access for audit trail
            audit_log.log(
                user=request.user.id,
                action=func.__name__,
                resource=args[0] if args else None,
                timestamp=datetime.utcnow(),
            )

            return func(request, *args, **kwargs)
        return wrapper
    return decorator

@require_pci_access('pci_admin')
def view_card_details(request, payment_id: str):
    # Only users with pci_admin role can access this
    payment = Payment.objects.get(id=payment_id)
    return render_card_details(payment)
```

## Logging and Monitoring

PCI DSS requires comprehensive logging of all access to cardholder data:

```python
import logging

pci_logger = logging.getLogger('pci.audit')

def log_pci_access(user: str, action: str, resource: str):
    """Log all access to PCI-scoped resources."""
    pci_logger.info(
        json.dumps({
            "event": "pci_access",
            "user": user,
            "action": action,
            "resource": resource,
            "timestamp": datetime.utcnow().isoformat(),
            "source_ip": get_client_ip(),
        })
    )

# Never log card data
def sanitize_for_log(data: dict) -> dict:
    """Remove sensitive fields before logging."""
    sensitive_fields = ['card_number', 'cvv', 'pin', 'ssn']
    return {
        k: '***REDACTED***' if k in sensitive_fields else v
        for k, v in data.items()
    }
```

## PCI DSS SAQ Checklist for Developers

| Requirement            | What It Means for Your Code                     |
| ---------------------- | ----------------------------------------------- |
| 1. Firewall config     | No direct DB access from public IPs             |
| 2. Default passwords   | No hardcoded credentials in code or config      |
| 3. Protect stored data | Tokenize card numbers; encrypt sensitive fields |
| 4. Encrypt in transit  | TLS 1.2+ everywhere; no HTTP for payment pages  |
| 6. Secure systems      | Patch dependencies; run SAST/DAST in CI         |
| 7. Restrict access     | Role-based access; least privilege              |
| 8. Unique IDs          | No shared accounts; MFA for admin access        |
| 10. Track access       | Audit logs for all PCI-scoped resource access   |
| 11. Test security      | Regular vulnerability scans; penetration tests  |

## Lessons Learned

1. **Tokenize everything** — if you never see card data, you're mostly out of scope
2. **Use hosted fields** — let the payment processor handle card input
3. **Log all access** — auditors will ask for access logs
4. **Never log card data** — even accidentally; use sanitization helpers
5. **Automate compliance checks** — PCI checks should be part of CI/CD

---

_Questions about PCI compliance? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
