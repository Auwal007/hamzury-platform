// the desk: holding, venture and finance staff. registered by createApp in app.js.
import { fail, intParam } from './http.js';
import { tokenUrlsafe, sha256hex } from './security.js';
import {
  DELIVERED_DAYS, ENQUIRY_DAYS, NOTICE_DAYS, ROLE_HOLDING, SECRET_WORDS, UPLOAD_DAYS, VENTURES, WORK_LABEL,
  addDays, attachmentList, cut, daysBetween, daysIn, packageView, parseJson, parseTs,
} from './app.js';

const FINANCE_CHECKS = [
  ['entity', 'confirm the company that invoices clients, and its tax treatment'],
  ['margins', 'review item costs, margins and the profit on monthly services'],
  ['invoices', 'approve the invoice layout and the categories in the records'],
  ['services', 'define the bookkeeping and tax services hamzury can responsibly offer'],
  ['dashboards', 'check the numbers and definitions on financial dashboards'],
];
const STAGES = ['awareness', 'strategy', 'structure', 'systems', 'success'];
const LEVELS_ALL = ['minimum', 'standard', 'protection', 'scaling', 'renewals'];
const MAX_PRICE = 5_000_000_000_00;

export function registerDesk(app, { R, auth, body, f, cronKeyOk, pricing, setting, markPaid, accessEngagement, loadCatalogue }) {
  const { cfg, storage } = app;
  const { one, log, tx, hoursSince } = app.helpers;
  const { paymentOp, storageOp } = app.locks;
  const subView = app.helpers.subView;
  const json = (s, d) => parseJson(s, d);
  const dump = (v, keys) => JSON.stringify(Object.fromEntries(keys.filter(k => v[k] !== undefined && v[k] !== null).map(k => [k, v[k]])));

  // ---------------------------------------------------------------- payments desk
  // the transfer the client reported has not arrived: the order goes back to waiting for payment
  R('POST', '/api/admin/orders/{oid}/reject', async ctx => {
    const oid = intParam(ctx.params.oid, 'oid');
    const user = await auth.money(ctx);
    const b = body(ctx, { note: f.str({ default: '', max: 300 }) });
    return paymentOp(() => tx(async c => {
      const o = await one(c, 'orders', oid);
      if (o.status !== 'awaiting_confirmation') fail(409, 'this order is not waiting for a check');
      await c.run("UPDATE orders SET status='pending',transfer_note=? WHERE id=?", ('not received yet. ' + b.note.trim()).trim(), oid);
      await log(c, user.username, 'order.transfer_not_found', 'orders', oid, b.note);
      return { ok: true };
    }));
  });

  R('GET', '/api/admin/subscriptions', async ctx => {
    await auth.money(ctx);
    const rows = await tx(c => c.all(`SELECT s.*,c.ref,c.name AS cname,c.business,c.phone FROM subscriptions s JOIN clients c ON c.id=s.client_id
                                      ORDER BY CASE s.status WHEN 'grace' THEN 0 WHEN 'paused' THEN 1 WHEN 'active' THEN 2 ELSE 3 END, s.next_due`));
    return rows.map(s => ({ ...subView(s), client_id: s.client_id, ref: s.ref, client: s.cname, business: s.business, phone: s.phone }));
  });

  R('PATCH', '/api/admin/subscriptions/{sid}', async ctx => {
    const sid = intParam(ctx.params.sid, 'sid');
    const user = await auth.money(ctx);
    const b = body(ctx, { status: f.oneOf(['active', 'paused', 'cancelled'], { default: null, nullable: true }), next_due: f.str({ default: null, nullable: true, pattern: /^\d{4}-\d{2}-\d{2}$/ }) });
    return paymentOp(() => tx(async c => {
      await one(c, 'subscriptions', sid);
      if (b.next_due) {
        const d = new Date(b.next_due + 'T00:00:00Z');
        if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== b.next_due) fail(400, 'please enter a real date');
        await c.run('UPDATE subscriptions SET next_due=?,updated_at=now_ts() WHERE id=?', b.next_due, sid);
      }
      if (b.status) {
        await c.run("UPDATE subscriptions SET status=?,cancel_at=CASE WHEN ?='active' THEN NULL ELSE cancel_at END,updated_at=now_ts() WHERE id=?", b.status, b.status, sid);
        if (b.status === 'cancelled') await c.run("UPDATE orders SET status='cancelled' WHERE subscription_id=? AND status='pending'", sid);
      }
      await log(c, user.username, 'subscription.update', 'subscriptions', sid, dump(b, ['status', 'next_due']));
      return subView(await c.get('SELECT * FROM subscriptions WHERE id=?', sid));
    }));
  });

  // ---------------------------------------------------------------- settings, vat, finance
  const getSettings = c => (async () => {
    const checks = json(await setting(c, 'finance_checks') || '{}', {});
    return { ...(await pricing(c)), finance_checks: FINANCE_CHECKS.map(([key, label]) => ({ key, label, ...(checks[key] || { done: false }) })) };
  })();

  R('GET', '/api/admin/settings', async ctx => { await auth.money(ctx); return tx(getSettings); });

  R('PUT', '/api/admin/settings', async ctx => {
    const user = await auth.financeOrOwner(ctx);
    const b = body(ctx, { entity_name: f.str({ min: 2, max: 160 }), entity_rc: f.str({ default: '', max: 40 }), vat_registered: f.bool({ default: false }),
      vat_rate_bp: f.int({ default: 750, ge: 0, le: 2500 }), vat_tin: f.str({ default: '', max: 40 }) });
    return tx(async c => {
      for (const [k, v] of [['entity_name', b.entity_name.trim()], ['entity_rc', b.entity_rc.trim()], ['vat_registered', b.vat_registered ? '1' : '0'],
        ['vat_rate_bp', String(b.vat_rate_bp)], ['vat_tin', b.vat_tin.trim()]]) {
        await c.run(`INSERT INTO settings(key,value,updated_by,updated_at) VALUES(?,?,?,now_ts())
                     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at`, k, v, user.username);
      }
      await log(c, user.username, 'settings.money', 'settings', 0, JSON.stringify(b));
      return getSettings(c);
    });
  });

  R('PUT', '/api/admin/finance-checks/{key}', async ctx => {
    const user = await auth.financeOrOwner(ctx);
    const key = ctx.params.key;
    const b = body(ctx, { done: f.bool(), note: f.str({ default: '', max: 400 }) });
    if (!FINANCE_CHECKS.some(([k]) => k === key)) fail(404, 'record not found');
    await tx(async c => {
      const checks = json(await setting(c, 'finance_checks') || '{}', {});
      checks[key] = { done: b.done, note: b.note.trim(), by: user.display_name, at: app.today() };
      await c.run(`INSERT INTO settings(key,value,updated_by,updated_at) VALUES('finance_checks',?,?,now_ts()) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        JSON.stringify(checks), user.username);
      await log(c, user.username, 'finance.check', 'settings', 0, `${key} ${b.done ? 'True' : 'False'}`);
    });
    return { ok: true };
  });

  // finance classifies each service: vat applies to our professional fee, or it does not
  R('PATCH', '/api/admin/packages/{pid}/vat', async ctx => {
    const pid = intParam(ctx.params.pid, 'pid');
    const user = await auth.money(ctx);
    const b = body(ctx, { vat: f.bool() });
    await tx(async c => {
      await one(c, 'packages', pid);
      await c.run('UPDATE packages SET vat=? WHERE id=?', b.vat ? 1 : 0, pid);
      await log(c, user.username, 'package.vat', 'packages', pid, b.vat ? 'True' : 'False');
    });
    return { ok: true };
  });

  R('POST', '/api/admin/orders/{oid}/refunded', async ctx => {
    const oid = intParam(ctx.params.oid, 'oid');
    const user = await auth.money(ctx);
    return paymentOp(() => tx(async c => {
      const o = await one(c, 'orders', oid);
      if (o.status !== 'refund_due') fail(409, 'this payment is not waiting for a refund');
      await c.run("UPDATE orders SET status='refunded',refunded_at=now_ts() WHERE id=?", oid);
      await log(c, user.username, 'order.refunded', 'orders', oid, o.reference);
      return { ok: true };
    }));
  });

  // the finance desk's today page
  R('GET', '/api/admin/money', async ctx => {
    await auth.money(ctx);
    return tx(async c => {
      const q = async sql => Number(await c.val(sql));
      return {
        transfers_to_confirm: await q("SELECT COUNT(*) FROM orders WHERE status='awaiting_confirmation'"),
        refunds_due: await q("SELECT COUNT(*) FROM orders WHERE status='refund_due'"),
        paid_this_month_minor: await q("SELECT COALESCE(SUM(total_minor),0) FROM orders WHERE status='paid' AND paid_at>=month_start()"),
        vat_this_month_minor: await q("SELECT COALESCE(SUM(vat_minor),0) FROM orders WHERE status='paid' AND paid_at>=month_start()"),
        monthly_active: await q("SELECT COUNT(*) FROM subscriptions WHERE status IN ('active','grace')"),
        monthly_due_minor: await q("SELECT COALESCE(SUM(amount_minor),0) FROM subscriptions WHERE status IN ('active','grace') AND cancel_at IS NULL"),
        monthly_overdue: await q("SELECT COUNT(*) FROM subscriptions WHERE status='grace'"),
        paused: await q("SELECT COUNT(*) FROM subscriptions WHERE status='paused'"),
        prices_to_approve: await q("SELECT COUNT(*) FROM packages WHERE active=1 AND price_status!='approved' AND basis!='quote'"),
      };
    });
  });

  // ---------------------------------------------------------------- venture follow-up: every assigned job has an update rhythm
  // update rhythm for one job: when the next venture update is due, and whether the job is past its due date
  async function engFollow(c, e) {
    const out = { update_state: 'not_required', update_due_at: null, past_due: false };
    if (e.status === 'delivered') return out;
    if (e.due_date && e.due_date < app.today()) out.past_due = true;
    if (['awaiting_onboarding', 'review'].includes(e.status) || !e.assigned_user_id) return out;  // review: the venture is waiting on holding's final check
    const last = await c.val('SELECT MAX(created_at) FROM reports WHERE engagement_id=?', e.id);
    const base = Math.max(...[last, e.assigned_at, e.onboarding_at, e.created_at].map(x => parseTs(x) || 0));
    const due = base + cfg.UPDATE_HOURS * 3600;
    const left = due - app.time();
    out.update_due_at = new Date((due + 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');  // nigeria time
    out.update_state = left <= 0 ? 'overdue' : left <= cfg.UPDATE_HOURS * 900 ? 'due_soon' : 'on_track';
    return out;
  }

  // per venture: open work, late updates, late jobs, and delivery against the date we promised
  R('GET', '/api/admin/scoreboard', async ctx => {
    await auth.holding(ctx);
    const out = Object.fromEntries(VENTURES.map(v => [v, { venture: v, open: 0, unassigned: 0, updates_overdue: 0, past_due: 0, asked_by_client: 0, delivered: 0, on_time: 0, returned_reports: 0, days: [] }]));
    await tx(async c => {
      for (const e of await c.all('SELECT * FROM engagements')) {
        const s = out[e.venture];
        if (!s) continue;
        if (e.status === 'delivered') {
          s.delivered += 1;
          if (!e.due_date || (e.delivered_at || '').slice(0, 10) <= e.due_date) s.on_time += 1;
          const start = parseTs(e.assigned_at || e.onboarding_at || e.created_at);
          if (start && parseTs(e.delivered_at)) s.days.push((parseTs(e.delivered_at) - start) / 86400);
          continue;
        }
        s.open += 1;
        s.unassigned += e.assigned_user_id ? 0 : 1;
        const fl = await engFollow(c, e);
        s.updates_overdue += fl.update_state === 'overdue' ? 1 : 0;
        s.past_due += fl.past_due ? 1 : 0;
        s.asked_by_client += e.update_requested_at ? 1 : 0;
      }
      for (const r of await c.all("SELECT e.venture,COUNT(*) n FROM reports r JOIN engagements e ON e.id=r.engagement_id WHERE r.status='returned' GROUP BY e.venture")) {
        if (out[r.venture]) out[r.venture].returned_reports = Number(r.n);
      }
    });
    return Object.values(out).map(({ days, ...s }) => ({ ...s, avg_days: days.length ? Math.round((days.reduce((a, x) => a + x, 0) / days.length) * 10) / 10 : null }));
  });

  // what the client now owns: logins (addresses and account emails only, never passwords), who owns recovery, and that our access is removed
  R('PUT', '/api/admin/engagements/{eid}/handover', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const user = await auth.staff(ctx);
    const b = body(ctx, { accounts: f.list(f.dict(f.str()), { default: [], max: 30 }), copies_given: f.bool({ default: false }), client_owns_accounts: f.bool({ default: false }),
      sent_securely: f.bool({ default: false }), staff_access_removed: f.bool({ default: false }), notes: f.str({ default: '', max: 1500 }) });
    const accts = [];
    for (const a of b.accounts) {
      const row = Object.fromEntries(['service', 'login_url', 'account_email', 'recovery_owner'].map(k => [k, cut(String(a[k] ?? '').trim(), 200)]));
      if (SECRET_WORDS.test(Object.values(row).join(' '))) fail(400, 'never write passwords here. send them through an invitation or a password manager');
      if (row.service) accts.push(row);
    }
    if (SECRET_WORDS.test(b.notes)) fail(400, 'never write passwords here. send them through an invitation or a password manager');
    await tx(async c => {
      const e = await accessEngagement(c, user, eid);
      const data = { ...b, accounts: accts, by: user.display_name, at: app.today() };
      await c.run('UPDATE engagements SET handover=?,updated_at=now_ts() WHERE id=?', JSON.stringify(data), e.id);
      await log(c, user.username, 'handover.saved', 'engagements', eid);
    });
    return { ok: true };
  });

  // a keep flag: legal or required retention. routine deletion skips this client.
  R('POST', '/api/admin/clients/{cid}/hold', async ctx => {
    const cid = intParam(ctx.params.cid, 'cid');
    const user = await auth.owner(ctx);
    const b = body(ctx, { hold: f.bool() });
    await tx(async c => {
      await one(c, 'clients', cid);
      await c.run('UPDATE clients SET hold=? WHERE id=?', b.hold ? 1 : 0, cid);
      await log(c, user.username, 'client.hold', 'clients', cid, b.hold ? 'True' : 'False');
    });
    return { ok: true };
  });

  // scheduled deletion, never indefinite storage. invoices, payments, contracts and the audit log are kept on their own schedule.
  app.retentionRun = (day, actor = 'retention') => storageOp(() => tx(async c => {
    const out = { enquiries_removed: 0, uploads_removed: 0, files_removed: 0 };
    const cutoff = d => addDays(day, -d);
    const ec = cutoff(ENQUIRY_DAYS);
    for (const cl of await c.all(`SELECT * FROM clients WHERE hold=0 AND purged_at IS NULL AND status IN ('new','reviewing','recommended','closed')
                                  AND substr(updated_at,1,10) < ? AND substr(COALESCE(last_seen_at,'0'),1,10) < ? AND substr(created_at,1,10) < ?
                                  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id=clients.id AND (o.status!='cancelled' OR substr(o.created_at,1,10) >= ?))
                                  AND NOT EXISTS (SELECT 1 FROM engagements e WHERE e.client_id=clients.id)
                                  AND NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.client_id=clients.id AND substr(r.updated_at,1,10) >= ?)`, ec, ec, ec, ec, ec)) {
      await c.run(`UPDATE clients SET name='removed',business='',phone='',phone_key=?,email='',intake='{}',status='closed',purged_at=now_ts(),notes='' WHERE id=?`, 'removed-' + cl.id, cl.id);
      await c.run('DELETE FROM client_sessions WHERE client_id=?', cl.id);
      await c.run('DELETE FROM client_links WHERE client_id=?', cl.id);
      await c.run('DELETE FROM updates WHERE client_id=?', cl.id);
      await c.run("UPDATE recommendations SET heard='',advice='' WHERE client_id=?", cl.id);
      await c.run("UPDATE rec_items SET note='',request='' WHERE recommendation_id IN (SELECT id FROM recommendations WHERE client_id=?)", cl.id);
      await log(c, actor, 'retention.enquiry', 'clients', cl.id, 'no activity for 90 days');
      out.enquiries_removed += 1;
    }
    for (const e of await c.all(`SELECT e.* FROM engagements e JOIN clients cl ON cl.id=e.client_id WHERE cl.hold=0 AND e.status='delivered'
                                 AND e.attachments_purged_at IS NULL AND substr(e.delivered_at,1,10) < ?`, cutoff(UPLOAD_DAYS))) {
      for (const file of Object.values(json(e.attachments || '{}', {}))) if (file.stored) await storage.remove(file.stored);
      await c.run("UPDATE engagements SET attachments='{}',attachments_purged_at=now_ts() WHERE id=?", e.id);
      await log(c, actor, 'retention.uploads', 'engagements', e.id, '90 days after delivery');
      out.uploads_removed += 1;
    }
    for (const e of await c.all(`SELECT e.* FROM engagements e JOIN clients cl ON cl.id=e.client_id WHERE cl.hold=0 AND e.status='delivered' AND e.file_path IS NOT NULL
                                 AND e.file_purged_at IS NULL AND substr(e.delivered_at,1,10) < ?
                                 AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.client_id=e.client_id AND s.status IN ('active','grace','paused'))`, cutoff(DELIVERED_DAYS))) {
      await storage.remove(e.file_path);
      await c.run('UPDATE engagements SET file_path=NULL,file_purged_at=now_ts() WHERE id=?', e.id);
      await log(c, actor, 'retention.delivered', 'engagements', e.id, '12 months after handover');
      out.files_removed += 1;
    }
    return out;
  }));

  R('POST', '/api/admin/retention/run', async ctx => { const user = await auth.owner(ctx); return app.retentionRun(app.today(), user.username); });

  // one daily call for the scheduler: monthly billing, then scheduled deletion
  const daily = async () => ({ billing: await app.billingRun(app.today()), retention: await app.retentionRun(app.today()) });
  R('POST', '/api/daily/run', async ctx => { if (!cronKeyOk(ctx.headers['x-billing-key'])) fail(401, 'invalid key'); return daily(); });
  // vercel cron calls this every day with "Authorization: Bearer $CRON_SECRET" (see vercel.json)
  R('GET', '/api/cron/daily', async ctx => {
    const given = (ctx.headers.authorization || '').replace(/^Bearer /, '');
    const ok = (cfg.CRON_SECRET && given === cfg.CRON_SECRET) || cronKeyOk(given);
    if (!ok) fail(401, 'invalid key');
    return daily();
  });

  // ---------------------------------------------------------------- overview and clients
  const updateState = row => {
    if (row.status !== 'active') return 'not_required';
    const last = parseTs(row.last_update_at) || parseTs(row.created_at);
    const hours = last ? (app.time() - last) / 3600 : cfg.UPDATE_HOURS;
    return hours >= cfg.UPDATE_HOURS ? 'overdue' : hours >= cfg.UPDATE_HOURS * 0.75 ? 'due_soon' : 'on_track';
  };
  const ventureScope = user => {
    if (user.role === 'finance') fail(403, 'the finance desk sees payments, not client work');
    return ROLE_HOLDING.includes(user.role) ? null : user.venture;
  };

  R('GET', '/api/admin/overview', async ctx => {
    const user = await auth.staff(ctx);
    if (user.role === 'finance') return { finance: true };
    const v = ventureScope(user);
    return tx(async c => {
      const n = async (sql, ...a) => Number(await c.val(sql, ...a));
      if (v) {
        return {
          venture: v,
          work: (await c.all('SELECT status,COUNT(*) n FROM engagements WHERE venture=? GROUP BY status', v)).map(x => ({ status: x.status, n: Number(x.n) })),
          assigned_to_me: await n("SELECT COUNT(*) FROM engagements WHERE assigned_user_id=? AND status!='delivered'", user.id),
          returned: await n("SELECT COUNT(*) FROM reports r JOIN engagements e ON e.id=r.engagement_id WHERE e.venture=? AND r.status='returned'", v),
          waiting_for_holding: await n("SELECT COUNT(*) FROM reports r JOIN engagements e ON e.id=r.engagement_id WHERE e.venture=? AND r.status='submitted'", v),
        };
      }
      const clients = await c.all('SELECT id,status,last_update_at,created_at FROM clients');
      return {
        new_clients: clients.filter(x => x.status === 'new').length,
        reviewing: clients.filter(x => x.status === 'reviewing').length,
        payments_to_confirm: await n("SELECT COUNT(*) FROM orders WHERE status='awaiting_confirmation'"),
        onboarding_received: await n("SELECT COUNT(*) FROM engagements WHERE status='onboarding_received'"),
        in_review: await n("SELECT COUNT(*) FROM engagements WHERE status='review'"),
        updates_due: clients.filter(x => ['due_soon', 'overdue'].includes(updateState(x))).length,
        overdue: clients.filter(x => updateState(x) === 'overdue').length,
        revenue_paid_minor: await n("SELECT COALESCE(SUM(total_minor),0) FROM orders WHERE status='paid'"),
        reports_to_review: await n("SELECT COUNT(*) FROM reports WHERE status='submitted'"),
        unassigned: await n("SELECT COUNT(*) FROM engagements WHERE assigned_user_id IS NULL AND status!='delivered'"),
        update_hours: cfg.UPDATE_HOURS,
      };
    });
  });

  R('GET', '/api/admin/clients', async ctx => {
    await auth.holding(ctx);
    const rows = await tx(c => c.all(`SELECT c.id,c.ref,c.name,c.business,c.phone,c.path,c.status,c.created_at,c.last_update_at,c.intake,c.source,
                                      u.display_name AS owner_name,
                                      (SELECT status FROM recommendations r WHERE r.client_id=c.id) AS rec_status,
                                      (SELECT COALESCE(SUM(total_minor),0) FROM orders o WHERE o.client_id=c.id AND o.status='paid') AS paid_minor
                                      FROM clients c LEFT JOIN users u ON u.id=c.owner_user_id ORDER BY c.id DESC`));
    return rows.map(r => ({ ...r, paid_minor: Number(r.paid_minor), intake: json(r.intake, {}), update_state: updateState(r) }));
  });

  R('GET', '/api/admin/clients/{cid}', async ctx => {
    const cid = intParam(ctx.params.cid, 'cid');
    await auth.holding(ctx);
    return tx(async c => {
      const cl = { ...(await one(c, 'clients', cid)) };
      cl.intake = json(cl.intake, {});
      cl.update_state = updateState(cl);
      const rec = await c.get('SELECT * FROM recommendations WHERE client_id=?', cid);
      cl.recommendation = null;
      if (rec) {
        cl.recommendation = { ...rec, items: (await c.all(`SELECT r.*,p.name,p.venture,p.code,p.price_status,p.basis,p.grp,p.requires,p."overlaps",p.price_minor AS list_price
                                                          FROM rec_items r JOIN packages p ON p.id=r.package_id WHERE recommendation_id=? ORDER BY sort,r.id`, rec.id))
          .map(x => ({ ...x, package_name: x.name, venture: x.venture })) };
      }
      cl.orders = await c.all('SELECT * FROM orders WHERE client_id=? ORDER BY id DESC', cid);
      cl.engagements = (await c.all('SELECT * FROM engagements WHERE client_id=? ORDER BY id', cid)).map(e => ({ ...e, onboarding: json(e.onboarding, {}), attachments: attachmentList(e) }));
      cl.updates = await c.all('SELECT * FROM updates WHERE client_id=? ORDER BY id DESC LIMIT 30', cid);
      cl.activity = await c.all(`SELECT actor,event,summary,at FROM audit WHERE (entity='clients' AND entity_id=?)
                                 OR (entity='orders' AND entity_id IN (SELECT id FROM orders WHERE client_id=?))
                                 OR (entity='engagements' AND entity_id IN (SELECT id FROM engagements WHERE client_id=?))
                                 ORDER BY id DESC LIMIT 40`, cid, cid, cid);
      return cl;
    });
  });

  R('PATCH', '/api/admin/clients/{cid}', async ctx => {
    const cid = intParam(ctx.params.cid, 'cid');
    const user = await auth.holding(ctx);
    const b = body(ctx, { status: f.oneOf(['new', 'reviewing', 'recommended', 'active', 'completed', 'closed'], { default: null, nullable: true }),
      owner_user_id: f.int({ default: null, nullable: true }), notes: f.str({ default: null, nullable: true, max: 4000 }), plan_eta: f.str({ default: null, nullable: true, max: 60 }) });
    const keys = ['status', 'owner_user_id', 'notes', 'plan_eta'].filter(k => b.__sent.has(k));
    if (!keys.length) fail(400, 'nothing to change');
    await tx(async c => {
      await one(c, 'clients', cid);
      if (b.owner_user_id !== null && b.__sent.has('owner_user_id') && !(await c.get('SELECT 1 FROM users WHERE id=? AND active=1', b.owner_user_id))) fail(400, 'choose an active staff member');
      await c.run('UPDATE clients SET ' + keys.map(k => `${k}=?`).join(',') + ',updated_at=now_ts() WHERE id=?', ...keys.map(k => b[k]), cid);
      await log(c, user.username, 'client.updated', 'clients', cid, keys.join(', '));
    });
    return { ok: true };
  });

  R('POST', '/api/admin/clients/{cid}/link', async ctx => {
    const cid = intParam(ctx.params.cid, 'cid');
    const user = await auth.holding(ctx);
    const b = body(ctx, { dest: f.oneOf(['home', 'recommendation', 'roadmap', 'checkout', 'pay', 'onboarding', 'progress', 'files'], { default: 'home' }), days: f.int({ default: 14, ge: 1, le: 60 }) });
    const token = tokenUrlsafe(32);
    await tx(async c => {
      await one(c, 'clients', cid);
      await c.run('INSERT INTO client_links(token_hash,client_id,dest,expires_at,created_by) VALUES(?,?,?,?,?)', sha256hex(token), cid, b.dest, Math.floor(app.time() + b.days * 86400), user.username);
      await log(c, user.username, 'client.link_created', 'clients', cid, b.dest);
    });
    const p = `/track?t=${token}#${b.dest}`;
    return { url: cfg.BASE_URL ? cfg.BASE_URL + p : p, path: p, expires_days: b.days };
  });

  // who to follow up with today, and which message to send
  R('GET', '/api/admin/nudges', async ctx => {
    await auth.holding(ctx);
    const out = [];
    await tx(async c => {
      for (const r of await c.all("SELECT c.id,c.ref,c.name,c.business,c.phone,c.created_at,c.intake FROM clients c WHERE c.status IN ('new','reviewing') ORDER BY c.id")) {
        const h = hoursSince(r.created_at);
        const urgent = json(r.intake, {}).route === 'quick';
        if (urgent || h >= cfg.PLAN_NUDGE_HOURS) {
          out.push({ kind: urgent ? 'urgent' : 'plan_due', client_id: r.id, ref: r.ref, name: r.name, business: r.business, phone: r.phone,
            detail: (urgent ? 'asked for help fast. ' : '') + `${Math.trunc(h)} hours since they started`, template: urgent ? 'quick_reply' : 'plan_coming', dest: 'home' });
        }
      }
      for (const r of await c.all(`SELECT c.id,c.ref,c.name,c.business,c.phone,rc.published_at FROM clients c JOIN recommendations rc ON rc.client_id=c.id
                                   WHERE rc.status='published' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id=c.id AND o.status!='cancelled')`)) {
        const h = hoursSince(r.published_at);
        if (h >= 48) out.push({ kind: 'plan_not_chosen', client_id: r.id, ref: r.ref, name: r.name, business: r.business, phone: r.phone,
          detail: `plan published ${Math.floor(h / 24)} days ago, nothing chosen yet`, template: 'plan_reminder', dest: 'recommendation' });
      }
      for (const r of await c.all(`SELECT p.name AS package,c.id,c.ref,c.name,c.business,c.phone FROM rec_items ri JOIN packages p ON p.id=ri.package_id
                                   JOIN recommendations rc ON rc.id=ri.recommendation_id JOIN clients c ON c.id=rc.client_id
                                   WHERE ri.quote='ask' AND ri.requested_at IS NOT NULL`)) {
        out.push({ kind: 'route_requested', client_id: r.id, ref: r.ref, name: r.name, business: r.business, phone: r.phone,
          detail: 'answered the questions for ' + r.package + '. send their route and set the fee', template: 'route_reply', dest: 'roadmap', package: r.package });
      }
      for (const r of await c.all("SELECT o.created_at,o.total_minor,c.id,c.ref,c.name,c.business,c.phone FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.status='pending' AND o.kind='purchase'")) {
        if (hoursSince(r.created_at) >= 24) out.push({ kind: 'payment_pending', client_id: r.id, ref: r.ref, name: r.name, business: r.business, phone: r.phone,
          detail: 'chose packages but has not paid yet', template: 'payment_reminder', dest: 'pay', amount_minor: r.total_minor });
      }
      for (const r of await c.all("SELECT e.name AS package,e.updated_at,c.id,c.ref,c.name,c.business,c.phone FROM engagements e JOIN clients c ON c.id=e.client_id WHERE e.status='awaiting_onboarding'")) {
        if (hoursSince(r.updated_at) >= 24) out.push({ kind: 'onboarding_missing', client_id: r.id, ref: r.ref, name: r.name, business: r.business, phone: r.phone,
          detail: 'paid, but has not sent the details for ' + r.package, template: 'onboarding_reminder', dest: 'onboarding', package: r.package });
      }
      for (const r of await c.all(`SELECT c.id,c.ref,c.name,c.business,c.phone,
                                   (SELECT e.name FROM engagements e WHERE e.client_id=c.id AND e.status='delivered' ORDER BY e.delivered_at DESC LIMIT 1) AS done
                                   FROM clients c WHERE EXISTS (SELECT 1 FROM engagements e WHERE e.client_id=c.id AND e.status='delivered')
                                   AND EXISTS (SELECT 1 FROM rec_items ri JOIN recommendations rc ON rc.id=ri.recommendation_id
                                               WHERE rc.client_id=c.id AND rc.status='published' AND ri.id NOT IN (SELECT rec_item_id FROM engagements))
                                   AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id=c.id AND o.kind='purchase' AND o.status IN ('pending','awaiting_confirmation'))`)) {
        out.push({ kind: 'next_step', client_id: r.id, ref: r.ref, name: r.name, business: r.business, phone: r.phone,
          detail: `${r.done} delivered. the next step on their roadmap is waiting`, template: 'next_step', dest: 'progress', package: r.done });
      }
      for (const e of await c.all(`SELECT e.*,c.ref,c.name AS cname,c.business,c.phone AS cphone,u.display_name AS staff_name,u.phone AS staff_phone
                                   FROM engagements e JOIN clients c ON c.id=e.client_id LEFT JOIN users u ON u.id=e.assigned_user_id
                                   WHERE e.status NOT IN ('delivered')`)) {
        const base = { client_id: e.client_id, ref: e.ref, name: e.cname, business: e.business, package: e.name, venture: e.venture };
        if (e.update_requested_at) {
          out.push({ ...base, kind: 'client_asked', phone: e.cphone, detail: `asked for an update on ${e.name}. ask ${e.venture} for a report, then publish it`,
            template: 'update_coming', dest: 'progress' });
        }
        const fl = await engFollow(c, e);
        if (fl.update_state === 'overdue') {
          out.push({ ...base, kind: 'venture_late', to: 'venture', phone: e.staff_phone || '', staff: e.staff_name || e.venture,
            detail: `${e.staff_name || e.venture} has not sent an update on ${e.name} in ${cfg.UPDATE_HOURS} hours`, template: 'venture_chase', dest: 'progress' });
        }
        if (fl.past_due) {
          out.push({ ...base, kind: 'work_late', to: 'venture', phone: e.staff_phone || '', staff: e.staff_name || e.venture,
            detail: `${e.name} was due on ${e.due_date}. agree a new date and tell the client`, template: 'venture_late', dest: 'progress' });
        }
      }
      for (const e of await c.all(`SELECT e.name AS package,e.delivered_at,c.id,c.ref,c.name,c.business,c.phone FROM engagements e JOIN clients c ON c.id=e.client_id
                                   WHERE e.status='delivered' AND e.file_path IS NOT NULL AND e.file_purged_at IS NULL AND c.hold=0
                                   AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.client_id=c.id AND s.status IN ('active','grace','paused'))`)) {
        const ends = addDays(e.delivered_at, DELIVERED_DAYS);
        const left = daysBetween(app.today(), ends);
        if (left >= 0 && left <= NOTICE_DAYS) {
          out.push({ kind: 'files_expiring', client_id: e.id, ref: e.ref, name: e.name, business: e.business, phone: e.phone, package: e.package,
            detail: `the file for ${e.package} leaves their dashboard on ${ends}. remind them to download it`, template: 'files_expiring', dest: 'files' });
        }
      }
      for (const r of await c.all(`SELECT r.blocker,e.name AS package,e.venture,c.id,c.ref,c.name,c.business,c.phone FROM reports r JOIN engagements e ON e.id=r.engagement_id
                                   JOIN clients c ON c.id=e.client_id WHERE r.status='submitted' AND r.blocker!=''`)) {
        out.push({ kind: 'blocker', client_id: r.id, ref: r.ref, name: r.name, business: r.business, phone: r.phone, package: r.package,
          venture: r.venture, detail: `${r.venture} is blocked on ${r.package}: ${cut(r.blocker, 140)}`, template: 'update_coming', dest: 'progress' });
      }
      for (const r of await c.all(`SELECT s.name AS package,s.next_due,s.status,s.amount_minor,c.id,c.ref,c.name,c.business,c.phone FROM subscriptions s
                                   JOIN clients c ON c.id=s.client_id
                                   WHERE s.status IN ('active','grace') AND s.cancel_at IS NULL
                                   AND EXISTS (SELECT 1 FROM orders o WHERE o.subscription_id=s.id AND o.status='pending')`)) {
        const late = r.status === 'grace';
        out.push({ kind: late ? 'renewal_overdue' : 'renewal_due', client_id: r.id, ref: r.ref, name: r.name, business: r.business,
          phone: r.phone, detail: `${r.package} ${late ? 'was due' : 'is due'} on ${r.next_due}`,
          template: late ? 'renewal_overdue' : 'renewal_due', dest: 'progress', package: r.package, amount_minor: r.amount_minor });
      }
    });
    const order = { files_expiring: 4, urgent: 0, client_asked: 0, blocker: 1, work_late: 1, venture_late: 1, route_requested: 1, renewal_overdue: 2, payment_pending: 2,
      renewal_due: 3, onboarding_missing: 3, plan_due: 4, plan_not_chosen: 5, next_step: 6 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]);
  });

  R('GET', '/api/admin/insights', async ctx => {
    await auth.holding(ctx);
    const d = await tx(async c => ({
      clients: await c.all('SELECT id,intake,source,created_at FROM clients'),
      pub: new Map((await c.all("SELECT client_id,published_at FROM recommendations WHERE status='published'")).map(r => [r.client_id, r.published_at])),
      paid: new Map((await c.all("SELECT client_id,MIN(paid_at) p,SUM(total_minor) t FROM orders WHERE status='paid' GROUP BY client_id")).map(r => [r.client_id, [r.p, Number(r.t)]])),
      delivered: new Set((await c.all("SELECT DISTINCT client_id FROM engagements WHERE status='delivered'")).map(r => r.client_id)),
      repeat: new Set((await c.all("SELECT client_id FROM orders WHERE status='paid' GROUP BY client_id HAVING COUNT(*)>1")).map(r => r.client_id)),
      events: await c.all("SELECT flow,step,SUM(n) n FROM events WHERE day>=utc_day('30 days') GROUP BY flow,step ORDER BY flow,step"),
    }));
    const steps = {};
    for (const r of d.events) (steps[r.flow] ??= []).push({ step: r.step, n: Number(r.n) });
    const avg = pairs => {
      const vals = pairs.filter(([a, b]) => parseTs(a) && parseTs(b)).map(([a, b]) => (parseTs(b) - parseTs(a)) / 3600);
      return vals.length ? Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 10) / 10 : null;
    };
    const byRoute = {}, bySource = {};
    for (const cl of d.clients) {
      const i = json(cl.intake, {});
      const route = i.route || 'full';
      byRoute[route] = (byRoute[route] || 0) + 1;
      const src = { wa: 'whatsapp', tt: 'tiktok', ig: 'instagram', fb: 'facebook', bn: 'banner' }[i.src] || cl.source || 'holding';
      bySource[src] = (bySource[src] || 0) + 1;
    }
    const created = new Map(d.clients.map(cl => [cl.id, cl.created_at]));
    return {
      funnel: { started_questions: (steps.route || []).filter(x => x.step === 0).reduce((s, x) => s + x.n, 0), finished_questions: d.clients.length,
        plan_published: d.pub.size, paid: d.paid.size, delivered: d.delivered.size, bought_again: d.repeat.size },
      revenue_minor: [...d.paid.values()].reduce((s, [, t]) => s + t, 0),
      hours_to_plan: avg([...d.pub].filter(([k]) => created.has(k)).map(([k, v]) => [created.get(k), v])),
      hours_plan_to_paid: avg([...d.paid].filter(([k]) => d.pub.has(k)).map(([k, v]) => [d.pub.get(k), v[0]])),
      by_route: byRoute, by_source: bySource, steps,
    };
  });

  // ---------------------------------------------------------------- catalogue
  const question = f.model({ label: f.str({ min: 2, max: 200 }), kind: f.oneOf(['text', 'long', 'choice', 'file'], { default: 'text' }),
    options: f.list(f.str(), { default: [], max: 12 }), required: f.bool({ default: true }), why: f.str({ default: '', max: 300 }) });  // why: shown to the client
  const packageFields = {
    venture: f.oneOf([...VENTURES, 'holding', 'finance']), code: f.str({ default: '', max: 12, pattern: /^([A-Z]{2}-\d{2,3})?$/ }),
    level: f.oneOf(LEVELS_ALL, { default: 'standard' }), exclusions: f.list(f.str(), { default: [], max: 15 }),
    basis: f.oneOf(['fixed', 'from', 'monthly', 'session', 'request', 'workflow', 'quote'], { default: 'fixed' }), price_status: f.oneOf(['proposed', 'approved'], { default: 'approved' }),
    external: f.str({ default: '', max: 400 }), format: f.oneOf(['file', 'document', 'workbook', 'folder', 'bundle', 'workspace', 'website', 'guide', 'service'], { default: 'document' }),
    group: f.str({ default: '', max: 40 }), requires: f.list(f.str(), { default: [], max: 8 }), overlaps: f.list(f.str(), { default: [], max: 8 }),
    name: f.str({ min: 2, max: 120 }), summary: f.str({ default: '', max: 400 }), inclusions: f.list(f.str(), { default: [], max: 25 }),
    value: f.str({ default: '', max: 800 }), duration: f.str({ default: '', max: 80 }), price_minor: f.int({ ge: 0, le: MAX_PRICE }),
    onboarding: f.list(question, { default: [], max: 20 }), stage: f.oneOf(STAGES, { default: 'structure' }), active: f.bool({ default: true }),
  };
  const clean = xs => JSON.stringify(xs.map(x => x.trim()).filter(Boolean));
  const qDump = qs => JSON.stringify(qs.map(q => ({ label: q.label, kind: q.kind, options: q.options, required: q.required, why: q.why })));
  const pkgValues = b => [b.venture, b.name, b.summary, clean(b.inclusions), b.value, b.duration, b.price_minor, qDump(b.onboarding), b.stage, b.active ? 1 : 0,
    b.code, b.level, clean(b.exclusions), b.basis, b.price_status, b.external, b.format, b.group, JSON.stringify(b.requires), JSON.stringify(b.overlaps)];

  R('GET', '/api/admin/packages', async ctx => {
    await auth.staff(ctx);
    const rows = await tx(c => c.all(`SELECT * FROM packages ORDER BY CASE WHEN code='' THEN 1 ELSE 0 END, code COLLATE "C", venture COLLATE "C", name COLLATE "C"`));
    return rows.map(p => ({ ...packageView(p), stage: p.stage, active: Boolean(p.active) }));
  });

  R('POST', '/api/admin/packages', async ctx => {
    const user = await auth.holding(ctx);
    const b = body(ctx, packageFields);
    const id = await tx(async c => {
      if (b.code && await c.get('SELECT 1 FROM packages WHERE code=?', b.code)) fail(409, 'that code is already used');
      const nid = await c.val(`INSERT INTO packages(venture,name,summary,inclusions,value,duration,price_minor,onboarding,stage,active,
                               code,level,exclusions,basis,price_status,external,format,grp,requires,"overlaps")
                               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, ...pkgValues(b));
      await log(c, user.username, 'package.created', 'packages', nid, b.name);
      return nid;
    });
    return { id };
  });

  R('PUT', '/api/admin/packages/{pid}', async ctx => {
    const pid = intParam(ctx.params.pid, 'pid');
    const user = await auth.holding(ctx);
    const b = body(ctx, packageFields);
    await tx(async c => {
      await one(c, 'packages', pid);
      if (b.code && await c.get('SELECT 1 FROM packages WHERE code=? AND id!=?', b.code, pid)) fail(409, 'that code is already used');
      await c.run(`UPDATE packages SET venture=?,name=?,summary=?,inclusions=?,value=?,duration=?,price_minor=?,onboarding=?,stage=?,active=?,
                   code=?,level=?,exclusions=?,basis=?,price_status=?,external=?,format=?,grp=?,requires=?,"overlaps"=? WHERE id=?`, ...pkgValues(b), pid);
      await log(c, user.username, 'package.updated', 'packages', pid, b.name);
    });
    return { ok: true };
  });

  // the holding approves a catalogue price (optionally changing it). only approved prices reach clients.
  R('POST', '/api/admin/packages/{pid}/approve', async ctx => {
    const pid = intParam(ctx.params.pid, 'pid');
    const user = await auth.holding(ctx);
    const b = body(ctx, { price_minor: f.int({ default: null, nullable: true, gt: 0, le: MAX_PRICE }) });
    await tx(async c => {
      const p = await one(c, 'packages', pid);
      if (p.basis === 'quote') fail(400, 'this service is quoted for each client after a few questions. set its fee in their roadmap');
      const price = b.price_minor === null ? p.price_minor : b.price_minor;
      if (price <= 0) fail(400, 'please enter a price above zero');
      await c.run("UPDATE packages SET price_minor=?,price_status='approved' WHERE id=?", price, pid);
      // roadmaps pick up the approved price (unless the desk set a custom one), for anything not yet ordered or paid
      await c.run(`UPDATE rec_items SET price_minor=?,renewal_minor=CASE WHEN renewal='monthly' THEN ? ELSE renewal_minor END
                   WHERE package_id=? AND price_minor=?
                   AND id NOT IN (SELECT l.rec_item_id FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.status IN ('pending','awaiting_confirmation','paid','refund_due'))`,
      price, price, pid, p.price_minor);
      await log(c, user.username, 'price.approved', 'packages', pid, `${p.code} ${price}`);
    });
    return { ok: true };
  });

  R('POST', '/api/admin/catalogue/load', async ctx => {
    const user = await auth.holding(ctx);
    return tx(async c => {
      const res = await loadCatalogue(c, false);
      await log(c, user.username, 'catalogue.loaded', 'packages', null, JSON.stringify(res));
      return res;
    });
  });

  // ---------------------------------------------------------------- recommendation builder
  const recItem = f.model({
    package_id: f.int(), price_minor: f.int({ default: null, nullable: true, ge: 0, le: MAX_PRICE }), note: f.str({ default: '', max: 600 }),
    priority: f.int({ default: 2, ge: 1, le: 3 }),  // urgency: 1 needed now (red), 2 needed soon (amber), 3 optional (blue)
    assess: f.oneOf(['', 'verify', 'improve'], { default: '' }),  // verify: we are checking before we promise or charge
    has: f.bool({ default: false }),  // assessed as already adequate: the client sees "you have this"
    stage: f.oneOf(STAGES, { default: null, nullable: true }), level: f.oneOf(LEVELS_ALL, { default: 'standard' }),
    quote: f.oneOf(['fixed', 'ask'], { default: 'fixed' }), renewal: f.oneOf(['none', 'monthly', 'yearly'], { default: 'none' }),
    renewal_minor: f.int({ default: 0, ge: 0, le: MAX_PRICE }),
  });

  R('PUT', '/api/admin/clients/{cid}/recommendation', async ctx => {
    const cid = intParam(ctx.params.cid, 'cid');
    const user = await auth.holding(ctx);
    const b = body(ctx, { heard: f.str({ default: '', max: 2000 }), advice: f.str({ default: '', max: 3000 }), management: f.str({ default: '', max: 2000 }),
      items: f.list(recItem, { default: [], max: 30 }) });
    await tx(async c => {
      await one(c, 'clients', cid);
      const rec = await c.get('SELECT * FROM recommendations WHERE client_id=?', cid);
      const recId = rec ? rec.id : await c.val('INSERT INTO recommendations(client_id) VALUES(?) RETURNING id', cid);
      await c.run('UPDATE recommendations SET heard=?,advice=?,management=?,updated_at=now_ts() WHERE id=?', b.heard, b.advice, b.management, recId);
      const owned = new Set((await c.all('SELECT rec_item_id FROM engagements WHERE client_id=?', cid)).map(r => r.rec_item_id));
      const existing = new Map((await c.all('SELECT * FROM rec_items WHERE recommendation_id=?', recId)).map(r => [r.package_id, r]));
      const keep = new Set();
      for (const [i, it] of b.items.entries()) {
        const p = await one(c, 'packages', it.package_id);
        const price = it.price_minor === null ? p.price_minor : it.price_minor;
        const stage = it.stage || p.stage;
        if (existing.has(it.package_id)) {
          const r = existing.get(it.package_id);
          keep.add(r.id);
          if (owned.has(r.id)) {  // never reprice what the client already paid for
            await c.run('UPDATE rec_items SET note=?,sort=?,renewal=?,renewal_minor=? WHERE id=?', it.note, i, it.renewal, it.renewal_minor, r.id);
          } else {
            await c.run('UPDATE rec_items SET price_minor=?,note=?,priority=?,stage=?,sort=?,level=?,renewal=?,renewal_minor=?,quote=?,assess=?,client_has=? WHERE id=?',
              price, it.note, it.priority, stage, i, it.level, it.renewal, it.renewal_minor, it.quote, it.assess, it.has ? 1 : 0, r.id);
          }
        } else {
          keep.add(await c.val(`INSERT INTO rec_items(recommendation_id,package_id,price_minor,note,priority,stage,sort,level,renewal,renewal_minor,quote,assess,client_has)
                                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, recId, it.package_id, price, it.note, it.priority, stage, i, it.level, it.renewal, it.renewal_minor, it.quote, it.assess, it.has ? 1 : 0));
        }
      }
      for (const r of existing.values()) {
        if (keep.has(r.id)) continue;
        if (owned.has(r.id) || await c.get('SELECT 1 FROM order_lines WHERE rec_item_id=?', r.id)) fail(409, 'a package the client has ordered cannot be removed');
        await c.run('DELETE FROM rec_items WHERE id=?', r.id);
      }
      if ((await c.val('SELECT status FROM clients WHERE id=?', cid)) === 'new') await c.run("UPDATE clients SET status='reviewing' WHERE id=?", cid);
      await log(c, user.username, 'recommendation.saved', 'clients', cid, `${b.items.length} packages`);
    });
    return { ok: true };
  });

  R('POST', '/api/admin/clients/{cid}/recommendation/publish', async ctx => {
    const cid = intParam(ctx.params.cid, 'cid');
    const user = await auth.holding(ctx);
    await tx(async c => {
      const rec = await c.get('SELECT * FROM recommendations WHERE client_id=?', cid);
      if (!rec || !(await c.get('SELECT 1 FROM rec_items WHERE recommendation_id=?', rec.id))) fail(400, 'add at least one package first');
      if (!rec.advice.trim()) fail(400, 'write your recommendation summary first');
      const unapproved = (await c.all(`SELECT p.name FROM rec_items ri JOIN packages p ON p.id=ri.package_id
                                       WHERE ri.recommendation_id=? AND ri.quote='fixed' AND ri.assess!='verify' AND p.price_status!='approved'`, rec.id)).map(r => r.name);
      if (unapproved.length) fail(400, 'approve these prices in the catalogue first: ' + unapproved.join(', '));
      // alternatives (one registration type, one scuml category) may both be offered: the client can choose one
      await c.run("UPDATE recommendations SET status='published',published_at=now_ts() WHERE id=?", rec.id);
      await c.run("UPDATE clients SET status='recommended',last_update_at=now_ts() WHERE id=? AND status IN ('new','reviewing')", cid);
      await log(c, user.username, 'recommendation.published', 'clients', cid);
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- payments list
  R('GET', '/api/admin/orders', async ctx => {
    await auth.money(ctx);
    return tx(async c => {
      const rows = await c.all(`SELECT o.*,c.ref,c.name,c.business FROM orders o JOIN clients c ON c.id=o.client_id
                                WHERE o.status!='cancelled' ORDER BY (o.status='awaiting_confirmation') DESC,o.id DESC LIMIT 300`);
      for (const o of rows) {
        o.lines = await c.all(`SELECT l.price_minor,p.name,p.venture FROM order_lines l JOIN rec_items r ON r.id=l.rec_item_id
                               JOIN packages p ON p.id=r.package_id WHERE l.order_id=?`, o.id);
      }
      return rows;
    });
  });

  R('POST', '/api/admin/orders/{oid}/confirm', async ctx => {
    const oid = intParam(ctx.params.oid, 'oid');
    const user = await auth.money(ctx);
    return paymentOp(() => tx(async c => {
      const o = await one(c, 'orders', oid);
      if (!['pending', 'awaiting_confirmation'].includes(o.status)) fail(409, 'this order is not waiting for payment');
      if (o.method !== 'transfer') fail(409, 'card payments must be verified with the payment provider');
      await markPaid(c, o, user.username);
      return { ok: true };
    }));
  });

  // ---------------------------------------------------------------- delivery
  R('GET', '/api/admin/engagements', async ctx => {
    const user = await auth.staff(ctx);
    const v = ventureScope(user);
    return tx(async c => {
      const q = `SELECT e.*,c.ref,c.name AS client_name,c.business,c.intake,u.display_name AS assigned_name FROM engagements e
                 JOIN clients c ON c.id=e.client_id LEFT JOIN users u ON u.id=e.assigned_user_id`;
      const rows = v ? await c.all(q + ' WHERE e.venture=? ORDER BY e.updated_at DESC', v) : await c.all(q + ' ORDER BY e.updated_at DESC');
      const out = [];
      for (const e of rows) {
        const { intake, file_path: _hidden, ...d } = e;  // the private storage name never leaves the server
        const i = json(intake, {});
        d.situation = Object.fromEntries(['industry', 'stage', 'challenge', 'location', 'team'].map(k => [k, i[k] ?? '']));
        d.onboarding = json(e.onboarding, {});
        d.attachments = attachmentList(e);
        d.status_label = WORK_LABEL[e.status];
        d.reports = await c.all('SELECT * FROM reports WHERE engagement_id=? ORDER BY id DESC LIMIT 10', e.id);
        Object.assign(d, await engFollow(c, e));
        d.handover = json(e.handover || '{}', {});
        out.push(d);
      }
      return out;
    });
  });

  // holding hands a paid package to a named venture staff member, with a brief and a due date
  R('POST', '/api/admin/engagements/{eid}/assign', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const user = await auth.holding(ctx);
    const b = body(ctx, { assigned_user_id: f.int({ default: null, nullable: true }), due_date: f.str({ default: '', max: 10, pattern: /^(\d{4}-\d{2}-\d{2})?$/ }), brief: f.str({ default: '', max: 3000 }) });
    await tx(async c => {
      const e = await one(c, 'engagements', eid);
      if (b.assigned_user_id !== null) {
        const u = await c.get('SELECT * FROM users WHERE id=? AND active=1', b.assigned_user_id);
        if (!u || (!ROLE_HOLDING.includes(u.role) && u.venture !== e.venture)) fail(400, 'choose an active staff member from ' + e.venture);
      }
      let due = b.due_date;
      if (!due && b.assigned_user_id) {
        const d = daysIn((await c.get('SELECT duration FROM packages WHERE id=?', e.package_id)).duration);
        due = d ? addDays(app.today(), d) : '';
      }
      const changed = b.assigned_user_id !== e.assigned_user_id;
      await c.run(`UPDATE engagements SET assigned_user_id=?,due_date=?,brief=?,assigned_at=CASE WHEN ?::int=1 THEN now_ts() ELSE assigned_at END,
                   updated_at=now_ts() WHERE id=?`, b.assigned_user_id, due, b.brief.trim(), changed ? 1 : 0, eid);
      await log(c, user.username, 'work.assigned', 'engagements', eid, b.assigned_user_id === null ? 'None' : String(b.assigned_user_id));
    });
    return { ok: true };
  });

  // ventures report to holding. holding decides what the client sees.
  R('POST', '/api/admin/engagements/{eid}/reports', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const user = await auth.staff(ctx);
    const b = body(ctx, { progress: f.int({ ge: 0, le: 100 }), done: f.str({ min: 3, max: 1500 }), blocker: f.str({ default: '', max: 800 }),
      next_step: f.str({ min: 3, max: 800 }), ready: f.bool({ default: false }) });  // ready: ready for holding's final quality check
    const id = await tx(async c => {
      const e = await accessEngagement(c, user, eid);
      if (e.status === 'delivered') fail(409, 'this package is already delivered');
      if (e.status === 'awaiting_onboarding') fail(409, 'waiting for the client to send their details');
      const rid = await c.val('INSERT INTO reports(engagement_id,author,progress,done,blocker,next_step,ready) VALUES(?,?,?,?,?,?,?) RETURNING id',
        eid, user.username, b.progress, b.done.trim(), b.blocker.trim(), b.next_step.trim(), b.ready ? 1 : 0);
      await log(c, user.username, 'report.submitted', 'engagements', eid, `${b.progress}%`);
      return rid;
    });
    return { id };
  });

  R('GET', '/api/admin/reports', async ctx => {
    const user = await auth.staff(ctx);
    const v = ventureScope(user);
    const q = `SELECT r.*,e.name AS package,e.venture,e.client_id,e.progress AS client_progress,c.ref,c.business,c.name AS client_name
               FROM reports r JOIN engagements e ON e.id=r.engagement_id JOIN clients c ON c.id=e.client_id`;
    const tail = " ORDER BY (r.status='submitted') DESC, r.id DESC LIMIT 200";
    return tx(c => (v ? c.all(q + ' WHERE e.venture=?' + tail, v) : c.all(q + tail)));
  });

  const whatsappUpdate = (cl, progress, blocker, nextAction) => {
    const first = cl.name.trim() ? cl.name.trim().split(/\s+/)[0].toLowerCase() : '';
    return [`hello ${first},`, '', 'here is your hamzury update.', '', 'progress: ' + progress,
      'anything holding us back: ' + (blocker || 'nothing at the moment.'), 'next step: ' + nextAction, '',
      `you can follow every step with your hamzury id (${cl.ref}) at ${cfg.BASE_URL || 'our website'}/track.`].join('\n');
  };
  const publishFields = { progress: f.int({ ge: 0, le: 100 }), done: f.str({ min: 3, max: 1500 }), blocker: f.str({ default: '', max: 800 }), next_step: f.str({ min: 3, max: 800 }) };

  // holding checks the venture report, edits the wording for the client, and publishes it
  R('POST', '/api/admin/reports/{rid}/publish', async ctx => {
    const rid = intParam(ctx.params.rid, 'rid');
    const user = await auth.holding(ctx);
    const b = body(ctx, publishFields);
    const cl = await tx(async c => {
      const r = await c.get('SELECT * FROM reports WHERE id=?', rid);
      if (!r) fail(404, 'record not found');
      if (r.status !== 'submitted') fail(409, 'this report was already reviewed');
      const e = await one(c, 'engagements', r.engagement_id);
      const client = await one(c, 'clients', e.client_id);
      const status = r.ready ? 'review' : 'in_progress';
      if (e.status === 'delivered') fail(409, 'this package is already delivered');
      await c.run('UPDATE engagements SET progress=?,status=?,update_requested_at=NULL,updated_at=now_ts() WHERE id=?', Math.min(b.progress, 99), status, e.id);
      await c.run('INSERT INTO updates(client_id,engagement_id,progress,blocker,next_action,author) VALUES(?,?,?,?,?,?)',
        client.id, e.id, b.done.trim(), b.blocker.trim(), b.next_step.trim(), user.username);
      await c.run('UPDATE clients SET last_update_at=now_ts() WHERE id=?', client.id);
      await c.run("UPDATE reports SET status='published',reviewed_by=?,reviewed_at=now_ts() WHERE id=?", user.username, rid);
      await log(c, user.username, 'report.published', 'engagements', e.id, `${b.progress}%`);
      return client;
    });
    return { ok: true, whatsapp_text: whatsappUpdate(cl, b.done.trim(), b.blocker.trim(), b.next_step.trim()) };
  });

  R('POST', '/api/admin/reports/{rid}/return', async ctx => {
    const rid = intParam(ctx.params.rid, 'rid');
    const user = await auth.holding(ctx);
    const b = body(ctx, { note: f.str({ min: 3, max: 800 }) });
    await tx(async c => {
      const r = await c.get('SELECT * FROM reports WHERE id=?', rid);
      if (!r) fail(404, 'record not found');
      if (r.status !== 'submitted') fail(409, 'this report was already reviewed');
      await c.run("UPDATE reports SET status='returned',holding_note=?,reviewed_by=?,reviewed_at=now_ts() WHERE id=?", b.note.trim(), user.username, rid);
      await log(c, user.username, 'report.returned', 'engagements', r.engagement_id, b.note);
    });
    return { ok: true };
  });

  R('PATCH', '/api/admin/engagements/{eid}', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const user = await auth.holding(ctx);
    const b = body(ctx, { status: f.oneOf(['onboarding_received', 'in_progress', 'review', 'delivered'], { default: null, nullable: true }),
      progress: f.int({ default: null, nullable: true, ge: 0, le: 100 }) });
    const data = Object.fromEntries(['status', 'progress'].filter(k => b.__sent.has(k)).map(k => [k, b[k]]));
    await tx(async c => {
      const e = await accessEngagement(c, user, eid);
      if (data.status === 'delivered') {
        if (!e.file_path) fail(400, 'upload the deliverable first so the client can download it');
        data.progress = 100;
      }
      if (e.status === 'delivered' && 'status' in data && data.status !== 'delivered') fail(409, 'delivered work cannot be reopened here');
      const keys = Object.keys(data);
      if (!keys.length) fail(400, 'nothing to change');
      const sets = keys.map(k => `${k}=?`).join(',') + (data.status === 'delivered' ? ',delivered_at=now_ts()' : '');
      await c.run(`UPDATE engagements SET ${sets},updated_at=now_ts() WHERE id=?`, ...keys.map(k => data[k]), eid);
      if (data.status === 'delivered') {
        const left = Number(await c.val("SELECT COUNT(*) FROM engagements WHERE client_id=? AND status!='delivered'", e.client_id));
        await c.run('UPDATE clients SET last_update_at=now_ts()' + (left === 0 ? ",status='completed'" : '') + ' WHERE id=?', e.client_id);
      }
      await log(c, user.username, 'work.updated', 'engagements', eid, JSON.stringify(data));
    });
    return { ok: true };
  });

  R('POST', '/api/admin/clients/{cid}/updates', async ctx => {
    const cid = intParam(ctx.params.cid, 'cid');
    const user = await auth.holding(ctx);
    const b = body(ctx, { engagement_id: f.int({ default: null, nullable: true }), progress: f.str({ min: 3, max: 1200 }), blocker: f.str({ default: '', max: 800 }),
      next_action: f.str({ min: 3, max: 600 }) });
    const cl = await tx(async c => {
      const client = await one(c, 'clients', cid);
      if (b.engagement_id) {
        const e = await accessEngagement(c, user, b.engagement_id);
        if (e.client_id !== cid) fail(400, 'that work belongs to another client');
      }
      await c.run('INSERT INTO updates(client_id,engagement_id,progress,blocker,next_action,author) VALUES(?,?,?,?,?,?)',
        cid, b.engagement_id, b.progress.trim(), b.blocker.trim(), b.next_action.trim(), user.username);
      await c.run('UPDATE clients SET last_update_at=now_ts() WHERE id=?', cid);
      await log(c, user.username, 'update.posted', 'clients', cid, b.next_action);
      return client;
    });
    return { ok: true, whatsapp_text: whatsappUpdate(cl, b.progress.trim(), b.blocker.trim(), b.next_action.trim()) };
  });
}
