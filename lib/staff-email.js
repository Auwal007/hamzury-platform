// Staff email is a case-insensitive login identifier, assigned by the owner/operator.
export const normalizeStaffEmail = value => String(value ?? '').trim().toLowerCase();
export const validStaffEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/[\x00-\x1f\x7f]/.test(email);
