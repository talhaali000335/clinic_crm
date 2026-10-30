import { useEffect, useState } from "react";

let token = sessionStorage.getItem("t") || "";
// One helper for every call: adds the login token, throws readable errors, logs out on 401.
async function api(path, body, method) {
  const r = await fetch("/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { sessionStorage.clear(); location.reload(); }
  if (!r.ok) throw new Error(d.detail || "Request failed (" + r.status + ")");
  return d;
}
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (v, f) => (v == null ? "not measured yet" : f(v));
const Err = ({ e }) => (e ? <p className="err">{e}</p> : null);

function Login({ onDone }) {
  const [u, setU] = useState(""), [p, setP] = useState(""), [e, setE] = useState("");
  const go = async () => {
    try { const d = await api("login", { username: u, password: p }); token = d.token; sessionStorage.setItem("t", d.token); sessionStorage.setItem("me", JSON.stringify(d)); onDone(d); }
    catch (x) { setE(x.message); }
  };
  return (
    <div className="login"><h2>Clinic CRM</h2><p className="sub">Sign in to continue.</p>
      <div className="card">
        <input value={u} onChange={(x) => setU(x.target.value)} placeholder="Username" aria-label="Username" />
        <input type="password" value={p} onChange={(x) => setP(x.target.value)} placeholder="Password" aria-label="Password" onKeyDown={(x) => x.key === "Enter" && go()} />
        <button className="btn" onClick={go}>Sign in</button><Err e={e} />
      </div></div>
  );
}

function Dashboard({ me, go }) {
  const [d, setD] = useState(null), [log, setLog] = useState([]), [e, setE] = useState("");
  useEffect(() => {
    api("dashboard").then(setD).catch((x) => setE(x.message));
    if (me.role === "doctor") api("audit").then(setLog).catch(() => {});
  }, []);
  if (!d) return <><h2>Dashboard</h2><Err e={e} /></>;
  const m = d.metrics, has = m.n > 0, S = ({ l, v }) => <div className="stat"><b>{v}</b><span>{l}</span></div>;
  return (
    <>
      <h2>Dashboard</h2><p className="sub">Today at a glance.</p>
      <div className="stats"><S l="Appointments today" v={d.today.length} /><S l="Follow-ups due" v={d.followups.length} /><S l="Emails to approve" v={d.pending} /><S l="Patients" v={d.patients} /></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card"><h3>Today's schedule</h3>
          {d.today.map((a) => <div key={a.id} className="item" onClick={() => go("patients", a.patient_id)}><b>{a.time}</b> {a.patient}<small>{a.reason} · {a.status}</small></div>)}
          {!d.today.length && <p className="sub">No appointments today.</p>}</div>
        <div className="card"><h3>Follow-ups due</h3><p className="sub" style={{ margin: "0 0 8px" }}>Last visit 7+ days ago, nothing booked.</p>
          {d.followups.map((f) => <div key={f.id} className="item" onClick={() => go("patients", f.id)}><b>{f.name}</b><small>Last visit {f.last_visit}</small></div>)}
          {!d.followups.length && <p className="sub">Nobody is due.</p>}</div>
      </div>
      <div className="card"><h3>AI performance (measured from real requests)</h3>
        <div className="stats" style={{ marginBottom: 0 }}>
          <S l="p50 latency" v={fmt(m.p50, (x) => x + " ms")} /><S l="p95 latency" v={fmt(m.p95, (x) => x + " ms")} />
          <S l="cost per AI request" v={fmt(m.cost_per_request, (x) => "$" + x.toFixed(5))} /><S l="cache hit rate" v={fmt(m.cache_hit_rate, (x) => (x * 100).toFixed(0) + "%")} />
          <S l="verification pass rate" v={fmt(m.verify_pass_rate, (x) => (x * 100).toFixed(0) + "%")} /></div></div>
      {me.role === "doctor" && <div className="card" style={{ overflowX: "auto" }}><h3>Audit log</h3>
        <table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>AI</th><th>ms</th><th>Cached</th><th>Verified</th></tr></thead>
          <tbody>{log.map((r) => <tr key={r.id}><td>{new Date(r.at).toLocaleTimeString()}</td><td>{r.user}</td><td>{r.action}</td><td>{r.ai ? "yes" : ""}</td><td>{r.latency_ms ?? ""}</td><td>{r.cached ? "yes" : ""}</td><td>{r.verified == null ? "" : String(r.verified)}</td></tr>)}</tbody></table></div>}
    </>
  );
}

function Summary({ s }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ marginTop: 0 }}><span className={"tag " + (s.verified ? "ok" : "bad")}>{s.verified ? "verified against notes" : "not verified"}</span>{s.cached && <span className="tag">cache hit</span>}</div>
      <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
        {s.summary.split(/(\[n\d+\])/).map((t, i) => { const k = t.match(/^\[(n\d+)\]$/)?.[1]; return k ? <button key={i} className="cite" onClick={() => setOpen(open === k ? null : k)}>{k}</button> : <span key={i}>{t}</span>; })}
      </div>
      {open && s.cites[open] && <div className="src"><small>{s.cites[open].date}</small><br />{s.cites[open].text}</div>}
    </div>
  );
}

function Patients({ me, focus }) {
  const [q, setQ] = useState(""), [list, setList] = useState([]), [sel, setSel] = useState(focus || null), [d, setD] = useState(null);
  const [add, setAdd] = useState(false), [f, setF] = useState({ name: "", phone: "", email: "", age: "", gender: "female", email_consent: false });
  const [note, setNote] = useState(""), [sum, setSum] = useState(null), [dr, setDr] = useState({ purpose: "followup", lang: "en" }), [msg, setMsg] = useState(null), [busy, setBusy] = useState(""), [e, setE] = useState("");
  const run = async (key, fn) => { setBusy(key); setE(""); try { await fn(); } catch (x) { setE(x.message); } setBusy(""); };
  const loadList = () => api("patients?q=" + encodeURIComponent(q)).then(setList).catch((x) => setE(x.message));
  const loadOne = () => sel && api("patients/" + sel).then((r) => { setD(r); }).catch((x) => setE(x.message));
  useEffect(() => { loadList(); }, [q]);
  useEffect(() => { setSum(null); setMsg(null); setD(null); loadOne(); }, [sel]);
  return (
    <>
      <h2>Patients</h2><p className="sub">Every record view is written to the audit log.</p>
      <div className="grid">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: 12 }}><input className="full" placeholder="Search by name" value={q} onChange={(x) => setQ(x.target.value)} aria-label="Search patients" />
            <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setAdd(!add)}>{add ? "Cancel" : "+ New patient"}</button></div>
          {add && <div style={{ padding: "0 12px 12px", display: "grid", gap: 6 }}>
            <input placeholder="Full name" value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /><input placeholder="Phone" value={f.phone} onChange={(x) => setF({ ...f, phone: x.target.value })} />
            <input type="email" placeholder="Email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} />
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={f.email_consent} onChange={(x) => setF({ ...f, email_consent: x.target.checked })} /> Patient agreed to receive emails</label>
            <input type="number" min="0" max="120" placeholder="Age" value={f.age} onChange={(x) => setF({ ...f, age: x.target.value })} />
            <select value={f.gender} onChange={(x) => setF({ ...f, gender: x.target.value })}><option>female</option><option>male</option><option>other</option></select>
            <button className="btn sm" onClick={() => run("add", async () => { const p = await api("patients", { ...f, age: f.age === "" ? null : Number(f.age) }); setAdd(false); setF({ name: "", phone: "", email: "", age: "", gender: "female", email_consent: false }); await loadList(); setSel(p.id); })}>Save patient</button></div>}
          {list.map((p) => <div key={p.id} className={"item" + (sel === p.id ? " on" : "")} onClick={() => setSel(p.id)}>{p.name}<small>{p.age} · {p.gender}</small></div>)}
        </div>
        <div>
          <Err e={e} />
          {!d && <div className="card"><p className="sub" style={{ margin: 0 }}>Select a patient.</p></div>}
          {d && <>
            <div className="card"><h3>{d.patient.name}</h3><p className="sub" style={{ margin: 0 }}>{d.patient.age} years · {d.patient.gender} · {d.patient.phone}<br />{d.patient.email} <span className={"tag " + (d.patient.email_consent ? "ok" : "warn")}>{d.patient.email_consent ? "agreed to email" : "no email consent"}</span></p>
              <h3 style={{ marginTop: 14 }}>Draft an email for approval</h3>
              <div className="row" style={{ marginTop: 0 }}>
                <select value={dr.purpose} onChange={(x) => setDr({ ...dr, purpose: x.target.value })} aria-label="Purpose"><option value="followup">Follow-up check-in</option><option value="reminder">Appointment reminder</option><option value="missed">Missed appointment</option></select>
                <select value={dr.lang} onChange={(x) => setDr({ ...dr, lang: x.target.value })} aria-label="Language"><option value="en">English</option><option value="ur">Urdu</option></select>
                <button className="btn" disabled={busy === "draft"} onClick={() => run("draft", async () => setMsg(await api("patients/" + sel + "/draft", dr)))}>{busy === "draft" ? "Drafting..." : "Draft email"}</button></div>
              {msg?.status === "queued" && <div className="alert" style={{ background: "var(--okbg)", color: "var(--ok)" }}>Draft added to the Approvals page. Nothing has been sent.<div className={dr.lang === "ur" ? "urdu" : ""}><b>{msg.subject}</b><br />{msg.body}</div></div>}
              {msg?.status === "urgent" && <div className="alert"><b>Needs a human.</b> {msg.detail}</div>}
            </div>
            <div className="card"><h3>Appointments</h3>
              {d.appointments.map((a) => <div key={a.id} className="note">{a.date} {a.time} · {a.reason} <span className="tag">{a.status}</span></div>)}
              {!d.appointments.length && <p className="sub">None yet.</p>}</div>
            {d.notes === null ? <div className="card"><p className="sub" style={{ margin: 0 }}>Clinical notes are visible to doctors only.</p></div> :
              <div className="card"><h3>Visit notes</h3>
                <div className="row" style={{ marginTop: 0, marginBottom: 8 }}><button className="btn" disabled={busy === "sum"} onClick={() => run("sum", async () => setSum(await api("patients/" + sel + "/summary", {})))}>{busy === "sum" ? "Summarising..." : "AI summary"}</button></div>
                {sum && <Summary s={sum} />}
                <textarea style={{ marginTop: 12 }} placeholder="Add a visit note" value={note} onChange={(x) => setNote(x.target.value)} aria-label="New note" />
                <div className="row"><button className="btn ghost" disabled={!note.trim()} onClick={() => run("note", async () => { await api("patients/" + sel + "/notes", { text: note }); setNote(""); setSum(null); await loadOne(); })}>Save note</button></div>
                {d.notes.map((n) => <div key={n.id} className="note"><small>{n.at.slice(0, 10)} · {n.by}</small><div>{n.text}</div></div>)}</div>}
          </>}
        </div>
      </div>
    </>
  );
}

function Appointments() {
  const [date, setDate] = useState(today()), [rows, setRows] = useState([]), [pts, setPts] = useState([]), [f, setF] = useState({ patient_id: "", time: "10:00", reason: "" }), [e, setE] = useState("");
  const load = () => api("appointments?date=" + date).then(setRows).catch((x) => setE(x.message));
  useEffect(() => { load(); }, [date]);
  useEffect(() => { api("patients").then(setPts).catch(() => {}); }, []);
  const act = async (fn) => { setE(""); try { await fn(); await load(); } catch (x) { setE(x.message); } };
  return (
    <>
      <h2>Appointments</h2><p className="sub">Book and update visits.</p>
      <div className="card"><h3>New appointment</h3>
        <div className="row" style={{ marginTop: 0 }}>
          <select value={f.patient_id} onChange={(x) => setF({ ...f, patient_id: x.target.value })} aria-label="Patient"><option value="">Choose patient</option>{pts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input type="date" value={date} onChange={(x) => setDate(x.target.value)} aria-label="Date" /><input type="time" value={f.time} onChange={(x) => setF({ ...f, time: x.target.value })} aria-label="Time" />
          <input placeholder="Reason" value={f.reason} onChange={(x) => setF({ ...f, reason: x.target.value })} aria-label="Reason" />
          <button className="btn" onClick={() => act(() => api("appointments", { ...f, date }))}>Book</button></div><Err e={e} /></div>
      <div className="card" style={{ overflowX: "auto" }}><h3>{date}</h3>
        <table><thead><tr><th>Time</th><th>Patient</th><th>Reason</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((a) => <tr key={a.id}><td>{a.time}</td><td>{a.patient}</td><td>{a.reason}</td><td><span className="tag">{a.status}</span></td>
            <td>{[["done", "Done"], ["no_show", "No-show"], ["cancelled", "Cancel"]].map(([s, l]) => <button key={s} className="btn ghost sm" style={{ marginRight: 4 }} onClick={() => act(() => api("appointments/" + a.id, { status: s }, "PATCH"))}>{l}</button>)}</td></tr>)}</tbody></table>
        {!rows.length && <p className="sub">No appointments on this date.</p>}</div>
    </>
  );
}

function Approvals() {
  const [rows, setRows] = useState([]), [hist, setHist] = useState([]), [ed, setEd] = useState({}), [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(""), [e, setE] = useState(""), [ok, setOk] = useState("");
  const load = () => {
    api("messages?status=pending").then((r) => { setRows(r); setEd(Object.fromEntries(r.map((m) => [m.id, { subject: m.subject, body: m.body }]))); }).catch((x) => setE(x.message));
    api("messages?status=sent").then(setHist).catch(() => {});
  };
  useEffect(() => { load(); api("config").then(setCfg).catch(() => {}); }, []);
  const set = (id, k, v) => setEd({ ...ed, [id]: { ...ed[id], [k]: v } });
  const decide = async (id, decision) => {
    setE(""); setOk(""); setBusy(id);
    try { const r = await api("messages/" + id + "/decision", { decision, ...ed[id] }); setOk(decision === "approve" ? "Email sent to " + r.sent_to : "Draft rejected."); load(); }
    catch (x) { setE(x.message); }
    setBusy("");
  };
  return (
    <>
      <h2>Approvals</h2><p className="sub">AI drafts wait here. A real email is sent only when a person clicks Approve. You can edit the subject and text first.</p>
      {cfg && !cfg.email_ready && <div className="alert">Email is not set up on the server yet. Add SMTP_USER and SMTP_PASS (see the README). Approving will fail until then.</div>}
      {cfg?.override && <div className="alert">Test mode: every email is delivered to {cfg.override} instead of the patient.</div>}
      <Err e={e} />{ok && <p style={{ color: "var(--ok)" }}>{ok}</p>}
      {rows.map((m) => <div key={m.id} className="card"><b>{m.patient}</b> <span className="tag">{m.purpose}</span> <span className="tag">{m.lang}</span><div className="sub" style={{ margin: "4px 0 8px" }}>To: {m.to}</div>
        <input className="full" value={ed[m.id]?.subject ?? ""} onChange={(x) => set(m.id, "subject", x.target.value)} aria-label={"Subject for " + m.patient} />
        <textarea className={m.lang === "ur" ? "urdu" : ""} style={{ marginTop: 8 }} value={ed[m.id]?.body ?? ""} onChange={(x) => set(m.id, "body", x.target.value)} aria-label={"Email body for " + m.patient} />
        <div className="row"><button className="btn" disabled={busy === m.id} onClick={() => decide(m.id, "approve")}>{busy === m.id ? "Sending..." : "Approve and send email"}</button><button className="btn ghost" disabled={busy === m.id} onClick={() => decide(m.id, "reject")}>Reject</button></div></div>)}
      {!rows.length && <div className="card"><p className="sub" style={{ margin: 0 }}>No emails waiting for approval.</p></div>}
      <div className="card"><h3>Recently sent</h3>{hist.map((m) => <div key={m.id} className="note"><b>{m.patient}</b> <span className="tag ok">sent</span> <small>to {m.sent_to || m.to}</small><div><b>{m.subject}</b></div><div>{m.body}</div></div>)}{!hist.length && <p className="sub">None yet.</p>}</div>
    </>
  );
}

export default function App() {
  const [me, setMe] = useState(() => (token ? JSON.parse(sessionStorage.getItem("me") || "null") : null));
  const [page, setPage] = useState("dashboard"), [focus, setFocus] = useState(null);
  if (!me) return <Login onDone={setMe} />;
  const go = (p, id) => { setFocus(id || null); setPage(p); };
  const tabs = [["dashboard", "Dashboard"], ["patients", "Patients"], ["appointments", "Appointments"], ["approvals", "Approvals"]];
  return (
    <div className="shell">
      <aside><h1>Clinic CRM</h1><div className="who">{me.name} · {me.role}</div>
        {tabs.map(([k, l]) => <button key={k} className={page === k ? "on" : ""} onClick={() => go(k)}>{l}</button>)}
        <button className="out" onClick={() => { sessionStorage.clear(); location.reload(); }}>Sign out</button></aside>
      <main>{page === "dashboard" ? <Dashboard me={me} go={go} /> : page === "patients" ? <Patients me={me} focus={focus} key={focus || "p"} /> : page === "appointments" ? <Appointments /> : <Approvals />}</main>
    </div>
  );
}