# hamzury holding | production readiness gates

**Status (8 November 2026):** application hardening implemented and covered by regression tests. This is not approval of the business policies or production infrastructure. Complete the remaining host and business gates in `GO-LIVE.md` before live client use.

## critical release gates

- [ ] Verify legal entity details, official address/contact methods, service catalogue and the Brand Standard edition 07.
- [ ] Approve a privacy notice, purpose-by-purpose consent, retention/deletion policy, access request and breach handling procedures. Review Nigerian data protection requirements with qualified advisers.
- [ ] Register and secure the domain; enforce HTTPS and secure cookies; deploy behind reverse proxy/WAF.
- [x] Implement staff authenticator enrollment/login, password changes, owner-managed resets, operator recovery and session revocation. Production requires MFA enrollment before staff access client/payment records.
- [ ] Enroll the actual staff, verify operator recovery on the host and define owner offboarding responsibilities.
- [x] Persist authentication/form rate limits in SQLite so they survive app restarts and apply across workers sharing this disk.
- [ ] Configure proxy-level limits and complete an application security review for the actual exposure and workload.
- [ ] For any sensitive proposal, acceptance, contract or data request, require client identity verification. Bearer URLs alone do not meet this standard.
- [x] Add content validation, unsafe archive rejection, request-size limits and fail-closed ClamAV scanning for production uploads.
- [ ] Verify scanner signatures, host disk protection and suitable identity verification before requesting sensitive documents. A malware scan alone does not complete this review.
- [ ] Authorise prices, tax treatment, third-party fees, scope templates, refund rules, contract terms and payment confirmation authorities.
- [ ] Clarify venture and holding roles for approval, QA, delivery, client complaints and compliance escalation.
- [ ] Define delivery acceptance separately from holding QA completion; keep verifiable audit evidence.
- [x] Implement age-encrypted backup support, coordinated file snapshots, atomic archive publication and a restore tool that verifies SQLite integrity.
- [ ] Configure the backup recipient, off-server copies and a production restore drill. Keep the age private identity and application secret securely recoverable. Use the documented separate-volume rollback process; plan a database migration before scaling beyond one node.
- [ ] Set up error monitoring, audit review, log retention, update procedures and accessibility testing.
- [ ] Choose how WhatsApp links are delivered: manual in MVP; consent-aware official API integration may follow later.
- [ ] Configure an official public contact/WhatsApp number; current public site does not invent one.
- [ ] Configure and validate actual hosting, environment secrets and business continuity ownership.

## explicitly deferred

- AI auto-sending or writing verified operational facts to database without staff approval.
- Automatic pricing, unsupervised close/upsell, legally binding signatures, bulk marketing and unsolicited follow-up. Chosen recurring services have implemented payment charging and require gateway acceptance testing before live keys.
- Claiming any fixed sales conversion percentage or client business outcome.

## deployment principle

The web platform is an authoritative record for tasks and verified decisions, not a substitute for legal review, payment reconciliation or proof of identity. ChatGPT is a staff drafting/analysis companion, and its private chats do not automatically synchronise with this app.
