import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare, Send, Shield,
  Heart, AlertTriangle, X, Check, ChevronRight, ChevronLeft, Settings as Cog,
  LogOut, Users, Search, Wind, Flag, SkipForward, Star, Clock, Award,
  BookOpen, Eye, EyeOff, Sun, Moon, ArrowLeft, Ban, Volume2,
  Sparkles, UserCheck, Trash2, Phone, Loader
} from "lucide-react";
import Pusher from "pusher-js";
import { TOPICS, LANGUAGES } from "./shared/constants.js";

/* ------------------------------------------------------------------ *
 *  Late Hours — anonymous peer support
 *
 *  NOTHING IN THIS FILE IS SIMULATED USER DATA.
 *  Accounts, sessions, moods, presence, and matching are all real,
 *  served by the /api functions in this repo (Postgres + Pusher — see
 *  README.md). Anything the interface can't truthfully know yet (no
 *  matches recorded, nobody online) is shown as an empty state rather
 *  than an invented number.
 *
 *  Every conversation here is with a real, matched human listener —
 *  there is no AI listener option.
 * ------------------------------------------------------------------ */

const HANDLES = ["Willow", "Ash", "Juniper", "Wren", "Sage", "Rook", "Linden", "Marlow", "Vesper", "Bramble"];

const PROMPTS = [
  "What's been the hardest part of today?",
  "When did you last feel like yourself?",
  "What would you want someone to say to you right now?",
  "Is there anything you've been avoiding saying out loud?",
  "What's one thing keeping you upright this week?",
];

const RESOURCES = [
  { region: "International", name: "Find a Helpline", detail: "findahelpline.com — verified helplines in 130+ countries" },
  { region: "United States", name: "988 Suicide & Crisis Lifeline", detail: "Call or text 988" },
  { region: "United States", name: "Crisis Text Line", detail: "Text HOME to 741741" },
  { region: "United Kingdom", name: "Samaritans", detail: "Call 116 123, free, any time" },
  { region: "Anywhere", name: "Emergency services", detail: "If someone is in immediate danger, call your local emergency number" },
];

const TRAINING = [
  { title: "Listen longer than feels natural", body: "Most people stop listening the moment they think they understand. Wait past that point. The thing someone actually came to say usually arrives after the third or fourth pause, not the first." },
  { title: "Don't solve it", body: "You are not here to fix anyone. Advice given fast reads as 'please stop talking'. If you feel the urge to suggest something, ask a question instead and see what happens." },
  { title: "Reflect, don't parrot", body: "Repeating someone's words back sounds hollow. Say what you understood in your own words and let them correct you. Being corrected is useful — it means they're getting specific." },
  { title: "Sit with silence", body: "Silence on a call feels much longer than it is. Count to five before you fill it. People often use that gap to say the real thing." },
  { title: "Know your edge", body: "If someone describes being in danger, or you feel out of your depth, say so plainly and point them to a crisis line. Ending a call honestly is safer than staying in one you can't hold." },
];

const KUDOS = ["Really listened", "Didn't rush me", "Felt understood", "Kind", "Asked good questions", "Stayed calm"];

/* Public, free STUN servers — enough for most home/mobile networks to
   find a direct path to each other. Behind a stricter NAT (corporate
   networks, some carrier-grade NAT) a call can still fail to connect
   without a TURN relay, which isn't free to run; STUN-only is the right
   default for a project with no infrastructure budget. */
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/* ---------------------------------- utils --------------------------------- */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clsx = (...a) => a.filter(Boolean).join(" ");
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* Strip anything that could execute if this text is ever rendered as HTML
   or stored and replayed elsewhere. Belt and braces — React escapes by
   default, but notes and handles travel to the server. */
const sanitize = (s, max = 2000) =>
  String(s ?? "")
    .slice(0, max)
    .replace(/[<>]/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "");

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const h = (e) => setR(e.matches);
    m.addEventListener?.("change", h);
    return () => m.removeEventListener?.("change", h);
  }, []);
  return r;
}

/* Every /api call goes through here: same-origin, JSON in, JSON out, the
   session cookie riding along automatically. Thrown errors carry the
   server's own message so callers can show it directly. */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

/* One Pusher connection per tab, created the first time anything needs
   it. Auth for private channels goes through /api/pusher-auth, which
   checks the same session cookie every other endpoint does. */
let pusherClient = null;
function getPusherClient() {
  if (!pusherClient && import.meta.env.VITE_PUSHER_KEY) {
    pusherClient = new Pusher(import.meta.env.VITE_PUSHER_KEY, {
      cluster: import.meta.env.VITE_PUSHER_CLUSTER || "mt1",
      channelAuthorization: { endpoint: "/api/pusher-auth", transport: "ajax" },
    });
  }
  return pusherClient;
}

/* ---------------------------------- logo ---------------------------------- */

let markSeq = 0;

function Mark({ size = 28, className }) {
  const id = useMemo(() => `lh-mask-${++markSeq}`, []);
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      <mask id={id}>
        <rect width="32" height="32" fill="#000" />
        <circle cx="15" cy="16" r="14" fill="#fff" />
        <circle cx="22.5" cy="13.5" r="12.5" fill="#000" />
      </mask>
      <circle cx="15" cy="16" r="14" fill="#fcd34d" mask={`url(#${id})`} />
      <circle cx="11.5" cy="21" r="3.4" fill="#fda4af" />
    </svg>
  );
}

function Logo({ size = 28, className, showWord = true }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <Mark size={size} />
      {showWord && (
        <span className="font-serif leading-none" style={{ fontSize: size * 0.66 }}>
          Late Hours
        </span>
      )}
    </span>
  );
}

/* ------------------------------ design tokens ----------------------------- */

function useTheme(dark) {
  return useMemo(
    () =>
      dark
        ? {
            app: "bg-indigo-950 text-indigo-50",
            surface: "bg-indigo-900",
            sunken: "bg-indigo-950",
            border: "border-indigo-800",
            muted: "text-indigo-300",
            faint: "text-indigo-400",
            input: "bg-indigo-950 border-indigo-800 text-indigo-50 placeholder-indigo-400",
            hover: "hover:bg-indigo-800",
            chip: "bg-indigo-800 text-indigo-100",
            accentBtn: "bg-amber-200 text-indigo-950 hover:bg-amber-100",
            ghostBtn: "border border-indigo-700 text-indigo-100 hover:bg-indigo-800",
          }
        : {
            app: "bg-indigo-50 text-indigo-950",
            surface: "bg-white",
            sunken: "bg-indigo-100",
            border: "border-indigo-200",
            muted: "text-indigo-700",
            faint: "text-indigo-500",
            input: "bg-white border-indigo-200 text-indigo-950 placeholder-indigo-400",
            hover: "hover:bg-indigo-100",
            chip: "bg-indigo-100 text-indigo-900",
            accentBtn: "bg-indigo-950 text-amber-100 hover:bg-indigo-900",
            ghostBtn: "border border-indigo-300 text-indigo-900 hover:bg-indigo-100",
          },
    [dark]
  );
}

/* ------------------------------ small pieces ------------------------------ */

function Button({ variant = "accent", size = "md", className, children, ...rest }) {
  const t = rest._t;
  delete rest._t;
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-5 py-2.5 text-sm", lg: "px-7 py-3.5 text-base" };
  const variants = {
    accent: t.accentBtn,
    ghost: t.ghostBtn,
    danger: "bg-rose-500 text-white hover:bg-rose-400",
    quiet: clsx(t.muted, t.hover),
  };
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        sizes[size], variants[variant], className
      )}
    >
      {children}
    </button>
  );
}

function Field({ t, label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {children}
      {hint && <span className={clsx("block text-xs mt-1.5", t.faint)}>{hint}</span>}
    </label>
  );
}

function Input({ t, className, ...rest }) {
  return (
    <input
      {...rest}
      className={clsx(
        "w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors focus:border-amber-300",
        t.input, className
      )}
    />
  );
}

function Chip({ t, active, onClick, children, icon: Icon }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
        active ? "bg-amber-200 text-indigo-950 font-medium" : clsx(t.chip, t.hover)
      )}
    >
      {Icon && <Icon size={13} />}
      {children}
    </button>
  );
}

function Modal({ t, open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-indigo-950 bg-opacity-80" onClick={onClose} />
      <div role="dialog" aria-modal="true"
        className={clsx("relative w-full rounded-t-3xl sm:rounded-3xl border shadow-2xl max-h-full overflow-y-auto",
          wide ? "max-w-2xl" : "max-w-lg", t.surface, t.border)}>
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <h2 className="font-serif text-2xl leading-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close" className={clsx("rounded-full p-1.5", t.hover)}>
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

function Toasts({ items, dismiss }) {
  return (
    <div className="fixed bottom-5 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {items.map((n) => (
        <div key={n.id} onClick={() => dismiss(n.id)}
          className={clsx("cursor-pointer rounded-2xl px-4 py-3 text-sm shadow-xl",
            n.kind === "bad" ? "bg-rose-500 text-white" : "bg-amber-200 text-indigo-950")}>
          {n.text}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- landing --------------------------------- */

function Landing({ t, onStart, onSafety, presence }) {
  const reduced = useReducedMotion();
  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-5 lg:gap-16">
        <div className="lg:col-span-3">
          <h1 className="font-serif text-4xl leading-[1.1] sm:text-6xl">
            It's late and you don't want to explain yourself from the start.
          </h1>
          <p className={clsx("mt-6 max-w-xl text-base leading-relaxed sm:text-lg", t.muted)}>
            Late Hours connects you to a listener by voice, video, or text. No names, no history, no
            appointment. You talk, they listen, and it ends when you want it to.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button _t={t} size="lg" onClick={onStart}>Talk to someone</Button>
            <Button _t={t} size="lg" variant="ghost" onClick={onSafety}>
              <Shield size={16} /> If this is an emergency
            </Button>
          </div>

          <div className={clsx("mt-12 border-t pt-8", t.border)}>
            <div className="grid gap-8 sm:grid-cols-3">
              {[
                ["Nobody learns your name", "You pick a handle. Accounts hold preferences, not transcripts."],
                ["Always a real person", "Every listener is a trained peer — never software pretending to be one."],
                ["You can leave mid-sentence", "Skip, mute, or end at any point. No one is told why."],
              ].map(([h, b]) => (
                <div key={h}>
                  <h3 className="font-serif text-lg leading-snug">{h}</h3>
                  <p className={clsx("mt-2 text-sm leading-relaxed", t.faint)}>{b}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className={clsx("flex flex-col items-center justify-center rounded-3xl border px-6 py-14", t.surface, t.border)}>
            <Mark size={92} className={reduced ? "" : "transition-transform duration-700"} />
            <p className="mt-7 text-center font-serif text-xl leading-snug">
              Someone picks up, or something does.
            </p>
            <p className={clsx("mt-2 text-center text-sm leading-relaxed", t.faint)}>
              {presence.listenersOnline === null
                ? "Listener counts appear once the presence service responds."
                : `${presence.listenersOnline} listener${presence.listenersOnline === 1 ? "" : "s"} online now`}
            </p>
          </div>

          <div className={clsx("mt-6 rounded-2xl border p-5", t.surface, t.border)}>
            <p className="text-sm leading-relaxed">
              Late Hours isn't a substitute for professional care. Human listeners are trained peers,
              not clinicians, and can't diagnose or treat anything. If you're in danger, contact your
              local emergency number.
            </p>
            <button onClick={onSafety} className="mt-3 text-sm font-medium underline underline-offset-4">
              See crisis lines by country
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- auth ---------------------------------- */

function Auth({ t, onAuthed, notify, onBack }) {
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [age, setAge] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => {
    let s = 0;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  }, [pw]);

  const submit = async () => {
    setErr("");
    const clean = sanitize(email, 254).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) return setErr("That email address isn't complete.");
    if (pw.length < 12) return setErr("Passwords need at least 12 characters.");
    if (mode === "signup") {
      if (!age) return setErr("Confirm you're 18 or older to continue.");
      /* The account isn't created yet — signup needs a handle, role, and
         topics that Onboarding collects next. This just carries the
         credentials forward; /api/auth/signup runs once onboarding
         finishes, and that's where a taken email is actually caught. */
      onAuthed({ email: clean, pw, age18: age }, true);
      return;
    }
    setBusy(true);
    try {
      const { account } = await api("/api/auth/login", { method: "POST", body: { email: clean, password: pw } });
      onAuthed(account, false);
      notify(`Welcome back, ${account.handle}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-12 sm:py-16">
      <button onClick={onBack} className={clsx("mb-8 inline-flex items-center gap-2 self-start text-sm", t.faint)}>
        <ArrowLeft size={15} /> Back
      </button>

      <Logo size={30} className="mb-8" />

      <h1 className="font-serif text-3xl leading-tight sm:text-4xl">
        {mode === "signup" ? "Make an account you can stay anonymous behind." : "Sign back in."}
      </h1>
      <p className={clsx("mt-3 text-sm leading-relaxed", t.muted)}>
        {mode === "signup"
          ? "Your email is used for sign-in and nothing else. Listeners only ever see the handle you choose next."
          : "Your preferences and private notes are waiting."}
      </p>

      <div className="mt-8 space-y-5">
        <Field t={t} label="Email">
          <Input t={t} type="email" value={email} autoComplete="email" maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="you@example.com" />
        </Field>

        <Field t={t} label="Password" hint={mode === "signup" ? "Twelve characters minimum. Length beats complexity." : undefined}>
          <div className="relative">
            <Input t={t} type={show ? "text" : "password"} value={pw} className="pr-12" maxLength={128}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="At least 12 characters" />
            <button onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}
              className={clsx("absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5", t.hover)}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        {mode === "signup" && pw.length > 0 && (
          <div className="flex items-center gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={clsx("h-1 flex-1 rounded-full", i < strength ? "bg-amber-300" : t.sunken)} />
            ))}
            <span className={clsx("w-20 text-xs", t.faint)}>{["Weak", "Weak", "Fair", "Good", "Strong"][strength]}</span>
          </div>
        )}

        {mode === "signup" && (
          <button onClick={() => setAge(!age)} className="flex items-start gap-3 text-left">
            <span className={clsx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
              age ? "border-amber-300 bg-amber-200 text-indigo-950" : t.border)}>
              {age && <Check size={13} strokeWidth={3} />}
            </span>
            <span className={clsx("text-sm leading-relaxed", t.muted)}>
              I'm 18 or older. I understand listeners are trained peers, not licensed therapists.
            </span>
          </button>
        )}

        {err && (
          <p className="flex items-start gap-2 rounded-xl bg-rose-500 px-4 py-3 text-sm text-white">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {err}
          </p>
        )}

        <Button _t={t} size="lg" className="w-full" onClick={submit} disabled={busy}>
          {mode === "signup" ? "Create account" : busy ? "Signing in…" : "Sign in"}
        </Button>

        <p className={clsx("text-center text-sm", t.faint)}>
          {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
          <button className="font-medium underline underline-offset-4"
            onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setErr(""); }}>
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------- onboarding ------------------------------- */

function Onboarding({ t, draft, setDraft, onDone, notify }) {
  const [step, setStep] = useState(0);
  const steps = ["Your side of the call", "What you want to talk about", "How you'd like to connect", "Your handle"];

  const toggleTopic = (x) =>
    setDraft((d) => ({ ...d, topics: d.topics.includes(x) ? d.topics.filter((v) => v !== x) : [...d.topics, x] }));

  const canNext =
    (step === 0 && draft.role) ||
    (step === 1 && draft.topics.length > 0) ||
    (step === 2 && draft.mode) ||
    (step === 3 && draft.handle.trim().length >= 2);

  const next = () => {
    if (step < 3) return setStep(step + 1);
    onDone();
    notify(`You're set up, ${draft.handle.trim()}`);
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      <div className="mb-10 flex items-center gap-2">
        {steps.map((s, i) => (
          <span key={s} className={clsx("h-1 flex-1 rounded-full", i <= step ? "bg-amber-300" : t.sunken)} />
        ))}
      </div>

      <p className={clsx("text-sm", t.faint)}>Step {step + 1} of 4</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight sm:text-4xl">{steps[step]}</h1>

      <div className="mt-8">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { id: "seeker", icon: MessageSquare, h: "I want to talk", b: "You'll be matched with a listener. You lead, they follow." },
              { id: "listener", icon: Heart, h: "I want to listen", b: "You'll take calls from people who need an ear. Training comes first." },
              { id: "both", icon: Users, h: "Both, depending on the night", b: "Switch sides from your home screen whenever you like." },
            ].map((o) => (
              <button key={o.id} onClick={() => setDraft((d) => ({ ...d, role: o.id }))}
                className={clsx("rounded-2xl border p-5 text-left transition-colors",
                  draft.role === o.id ? "border-amber-300 bg-amber-200 text-indigo-950" : clsx(t.surface, t.border, t.hover))}>
                <o.icon size={20} />
                <h3 className="mt-3 font-serif text-lg">{o.h}</h3>
                <p className={clsx("mt-1.5 text-sm leading-relaxed", draft.role === o.id ? "text-indigo-900" : t.faint)}>{o.b}</p>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <>
            <p className={clsx("mb-5 text-sm leading-relaxed", t.muted)}>
              Pick as many as fit. These are used to match you, and you can change them before any call.
            </p>
            <div className="flex flex-wrap gap-2">
              {TOPICS.map((x) => (
                <Chip key={x} t={t} active={draft.topics.includes(x)} onClick={() => toggleTopic(x)}>{x}</Chip>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <div className="space-y-8">
            <div>
              <p className="mb-3 text-sm font-medium">Default call type</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "voice", label: "Voice only", icon: Volume2 },
                  { id: "video", label: "Video", icon: Video },
                  { id: "text", label: "Text", icon: MessageSquare },
                ].map((m) => (
                  <Chip key={m.id} t={t} icon={m.icon} active={draft.mode === m.id}
                    onClick={() => setDraft((d) => ({ ...d, mode: m.id }))}>{m.label}</Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-sm font-medium">Language</p>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((l) => (
                  <Chip key={l} t={t} active={draft.lang === l} onClick={() => setDraft((d) => ({ ...d, lang: l }))}>{l}</Chip>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <Field t={t} label="Handle" hint="This is all anyone sees. Change it any time in settings.">
              <Input t={t} value={draft.handle} maxLength={18}
                onChange={(e) => setDraft((d) => ({ ...d, handle: sanitize(e.target.value, 18) }))}
                onKeyDown={(e) => e.key === "Enter" && canNext && next()}
                placeholder="Pick something that isn't your name" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <span className={clsx("text-sm", t.faint)}>Or take one of these:</span>
              {HANDLES.slice(0, 6).map((h) => (
                <Chip key={h} t={t} onClick={() => setDraft((d) => ({ ...d, handle: h }))}>{h}</Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-10 flex items-center justify-between">
        <Button _t={t} variant="quiet" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          <ChevronLeft size={16} /> Back
        </Button>
        <Button _t={t} size="lg" onClick={next} disabled={!canNext}>
          {step === 3 ? "Finish" : "Continue"} <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------- home ---------------------------------- */

function Home({ t, user, setUser, sessions, moods, onMood, onMatchHuman, onTakeCall, onTraining, onSafety, presence, notify }) {
  const totalMin = sessions.reduce((a, s) => a + Math.round(s.seconds / 60), 0);
  const rated = sessions.filter((s) => s.rating > 0);
  const avg = rated.length ? (rated.reduce((a, s) => a + s.rating, 0) / rated.length).toFixed(1) : null;
  const [note, setNote] = useState("");

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl leading-tight sm:text-4xl">Evening, {user.handle}.</h1>
          <p className={clsx("mt-2 text-sm", t.muted)}>
            {sessions.length === 0
              ? "You haven't had a conversation here yet. The first one is the hardest to start."
              : `${sessions.length} conversation${sessions.length > 1 ? "s" : ""} · ${totalMin} minute${totalMin === 1 ? "" : "s"}`}
          </p>
        </div>
        {user.role !== "seeker" && (
          <span className={clsx("inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs",
            user.trained ? "bg-amber-200 text-indigo-950" : t.chip)}>
            {user.trained ? <><Award size={13} /> Trained listener</> : <><BookOpen size={13} /> Training incomplete</>}
          </span>
        )}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className={clsx("rounded-3xl border p-6 lg:col-span-2", t.surface, t.border)}>
          <h2 className="font-serif text-2xl">Start a conversation</h2>
          <p className={clsx("mt-2 text-sm leading-relaxed", t.muted)}>
            {presence.medianWaitSeconds === null
              ? "Wait times show up here once a few matches have happened."
              : `Median wait right now: ${presence.medianWaitSeconds} seconds.`}
          </p>

          <div className="mt-6 space-y-5">
            <div>
              <p className="mb-2.5 text-sm font-medium">Tonight I'd like to talk about</p>
              <div className="flex flex-wrap gap-2">
                {TOPICS.slice(0, 9).map((x) => (
                  <Chip key={x} t={t} active={user.topics.includes(x)}
                    onClick={() =>
                      setUser((u) => ({
                        ...u,
                        topics: u.topics.includes(x) ? u.topics.filter((v) => v !== x) : [...u.topics, x],
                      }))
                    }>{x}</Chip>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={clsx("text-sm", t.faint)}>Connect by</span>
              {[{ id: "voice", label: "Voice", icon: Volume2 }, { id: "video", label: "Video", icon: Video }, { id: "text", label: "Text", icon: MessageSquare }].map((m) => (
                <Chip key={m.id} t={t} icon={m.icon} active={user.mode === m.id}
                  onClick={() => setUser((u) => ({ ...u, mode: m.id }))}>{m.label}</Chip>
              ))}
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <Button _t={t} size="lg" onClick={onMatchHuman} disabled={user.topics.length === 0}>
              <Search size={16} /> Find a human listener
            </Button>
          </div>
          {user.topics.length === 0 && (
            <p className={clsx("mt-3 text-sm", t.faint)}>Pick at least one topic so we know who to reach for.</p>
          )}

          {user.role !== "seeker" && (
            <div className={clsx("mt-6 border-t pt-5", t.border)}>
              <Button _t={t} variant="ghost" onClick={() => (user.trained ? onTakeCall() : onTraining())}>
                <Heart size={16} /> {user.trained ? "Take a call" : "Finish training to listen"}
              </Button>
            </div>
          )}
        </div>

        <div className={clsx("rounded-3xl border p-6", t.surface, t.border)}>
          <h2 className="font-serif text-xl">How's tonight?</h2>
          <div className="mt-4 flex justify-between gap-1.5">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} onClick={() => { onMood(v); notify("Logged. Only you can see this."); }}
                aria-label={`Mood ${v} of 5`}
                className={clsx("flex-1 rounded-xl py-3 text-lg transition-colors",
                  moods[moods.length - 1]?.v === v ? "bg-amber-200 text-indigo-950" : clsx(t.sunken, t.hover))}>
                {["😔", "😕", "😐", "🙂", "😌"][v - 1]}
              </button>
            ))}
          </div>

          <div className={clsx("mt-6 border-t pt-5", t.border)}>
            <p className="text-sm font-medium">Your last 7 check-ins</p>
            {moods.length === 0 ? (
              <p className={clsx("mt-2 text-sm leading-relaxed", t.faint)}>Nothing logged yet.</p>
            ) : (
              <div className="mt-3 flex h-20 items-end gap-1.5">
                {moods.slice(-7).map((m, i) => (
                  <div key={i} className="flex-1">
                    <div className="w-full rounded-t-md bg-amber-300" style={{ height: `${(m.v / 5) * 72}px` }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={clsx("mt-5 border-t pt-5", t.border)}>
            <p className="text-sm font-medium">Private note</p>
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 2000))} rows={3}
              maxLength={2000} placeholder="Nobody else reads this."
              className={clsx("mt-2 w-full resize-none rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-amber-300", t.input)} />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className={clsx("rounded-3xl border p-6 lg:col-span-2", t.surface, t.border)}>
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-xl">Past conversations</h2>
            {avg && <span className={clsx("text-sm", t.faint)}>Your average rating {avg}</span>}
          </div>
          {sessions.length === 0 ? (
            <p className={clsx("mt-4 text-sm leading-relaxed", t.faint)}>
              Nothing here yet. After a call you can leave yourself a note — it's the only thing kept.
            </p>
          ) : (
            <ul className={clsx("mt-4 divide-y", t.border)}>
              {sessions.slice().reverse().map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {s.peer} · {s.mode === "video" ? "Video" : s.mode === "text" ? "Text" : "Voice"} · {fmtTime(s.seconds)}
                    </p>
                    {s.note && <p className={clsx("mt-1 truncate text-sm", t.faint)}>{s.note}</p>}
                    {s.kudos?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {s.kudos.map((k) => (
                          <span key={k} className={clsx("rounded-full px-2 py-0.5 text-xs", t.chip)}>{k}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {s.rating > 0 && (
                    <span className="flex shrink-0 items-center gap-1 text-sm">
                      {s.rating} <Star size={13} className="text-amber-300" fill="currentColor" />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={clsx("rounded-3xl border p-6", t.surface, t.border)}>
          <h2 className="font-serif text-xl">Safety</h2>
          <div className="mt-4 space-y-2">
            <button onClick={onSafety} className={clsx("flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-sm", t.sunken, t.hover)}>
              <span className="flex items-center gap-2.5"><Shield size={16} /> Crisis lines</span>
              <ChevronRight size={15} />
            </button>
            <button onClick={onTraining} className={clsx("flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-sm", t.sunken, t.hover)}>
              <span className="flex items-center gap-2.5"><BookOpen size={16} /> Listener training</span>
              <ChevronRight size={15} />
            </button>
          </div>
          <p className={clsx("mt-5 text-sm leading-relaxed", t.faint)}>
            Human listeners are peers who completed a short course. They can't diagnose, prescribe, or
            provide treatment.
          </p>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- queue ---------------------------------- */

/* role: "seeker" looking for a listener, or "listener" going available to
   take one. Either way this joins the real /api/queue row, then either
   gets matched inline (the other side was already waiting) or sits on a
   private Pusher channel until a later join matches it. */
function Queue({ t, user, role = "seeker", onMatched, onCancel, presence, notify }) {
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const reduced = useReducedMotion();
  const settled = useRef(false);

  useEffect(() => {
    const i = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel = null;
    const client = getPusherClient();

    (async () => {
      try {
        const body =
          role === "listener"
            ? { role: "listener", lang: user.lang, mode: user.mode }
            : { role: "seeker", topics: user.topics, lang: user.lang, mode: user.mode };
        const result = await api("/api/queue", { method: "POST", body });
        if (cancelled) return;
        if (result.matched) {
          settled.current = true;
          onMatched(result);
          return;
        }
        if (client) {
          channel = client.subscribe(`private-user-${user.id}`);
          channel.bind("matched", (payload) => {
            settled.current = true;
            onMatched(payload);
          });
        }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) client?.unsubscribe(`private-user-${user.id}`);
      /* Leaving mid-wait (cancelled, or the match already came through and
         we navigated away) — either way there's nothing left to hold open. */
      if (!settled.current) api("/api/queue", { method: "DELETE" }).catch(() => {});
    };
  }, [role, user.id, user.lang, user.mode, user.topics, onMatched]);

  if (err) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
        <AlertTriangle size={30} className={t.faint} />
        <h1 className="mt-6 font-serif text-3xl leading-tight">Couldn't join the queue.</h1>
        <p className={clsx("mt-4 text-sm leading-relaxed", t.muted)}>{err}</p>
        <Button _t={t} size="lg" variant="ghost" className="mt-8" onClick={onCancel}>Back</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="relative flex h-40 w-40 items-center justify-center">
        <span className={clsx("absolute h-full w-full rounded-full border border-indigo-700", !reduced && "animate-ping")} />
        <Mark size={40} />
      </div>
      <h1 className="mt-10 font-serif text-3xl leading-tight">
        {role === "listener" ? "You're available. Waiting for someone to talk to." : "Looking for someone with time."}
      </h1>
      <p className={clsx("mt-6 flex items-center gap-2 text-sm", t.faint)}>
        <Clock size={14} /> {fmtTime(secs)} waiting
      </p>
      {role === "seeker" && presence?.listenersOnline === 0 && (
        <p className={clsx("mt-4 text-sm leading-relaxed", t.muted)}>
          Nobody's online right now — you can keep waiting, and you'll be matched the moment someone is.
        </p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button _t={t} variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/* -------------------------------- consent --------------------------------- */

function Consent({ t, peer, user, onAccept, onCancel }) {
  const rules = [
    "I won't record, screenshot, or share anything from this call.",
    "I understand my listener is a trained peer, not a licensed therapist.",
    "If either of us is in danger, we'll stop and contact emergency services.",
  ];
  const [agreed, setAgreed] = useState([false, false, false]);
  const all = agreed.every(Boolean);

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <p className={clsx("text-sm", t.faint)}>Matched</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">{peer.handle} is ready when you are.</h1>

      <div className={clsx("mt-6 rounded-2xl border p-5", t.surface, t.border)}>
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-200 text-indigo-950">
            <span className="font-serif text-lg">{peer.handle[0]}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm leading-relaxed">{peer.blurb}</p>
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-3">
        {rules.map((r, i) => (
          <button key={r} onClick={() => setAgreed((a) => a.map((v, j) => (j === i ? !v : v)))}
            className={clsx("flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              agreed[i] ? "border-amber-300" : t.border, t.surface, t.hover)}>
            <span className={clsx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
              agreed[i] ? "border-amber-300 bg-amber-200 text-indigo-950" : t.border)}>
              {agreed[i] && <Check size={13} strokeWidth={3} />}
            </span>
            <span className="text-sm leading-relaxed">{r}</span>
          </button>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button _t={t} size="lg" disabled={!all} onClick={onAccept}>
          {user.mode === "video" ? <Video size={16} /> : <Phone size={16} />} Start
        </Button>
        <Button _t={t} size="lg" variant="ghost" onClick={onCancel}>Not now</Button>
      </div>
    </div>
  );
}

/* -------------------------------- breathing ------------------------------- */

function Breathing({ t, onClose }) {
  const [phase, setPhase] = useState(0);
  const [count, setCount] = useState(4);
  const durations = [4, 7, 8];
  const labels = ["Breathe in", "Hold", "Breathe out"];

  useEffect(() => {
    const i = setInterval(() => {
      setCount((c) => {
        if (c > 1) return c - 1;
        const n = (phase + 1) % 3;
        setPhase(n);
        return durations[n];
      });
    }, 1000);
    return () => clearInterval(i);
  }, [phase]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-3xl bg-indigo-950 bg-opacity-95">
      <div className={clsx("flex items-center justify-center rounded-full bg-amber-200 transition-all duration-1000 ease-in-out",
        phase === 2 ? "h-24 w-24" : "h-48 w-48")}>
        <span className="font-serif text-3xl text-indigo-950">{count}</span>
      </div>
      <p className="mt-8 font-serif text-2xl text-indigo-50">{labels[phase]}</p>
      <p className="mt-2 text-sm text-indigo-300">Four in, seven held, eight out.</p>
      <Button _t={t} variant="ghost" className="mt-8" onClick={onClose}>Back to the conversation</Button>
    </div>
  );
}

/* ---------------------------------- call ---------------------------------- */

function Call({ t, user, peer, onEnd, notify, onSafety }) {
  /* The mode that matters is the one the match actually negotiated
     (peer.mode, set from the /api/queue response) — not this browser's
     own stored preference, which can differ from whichever side's
     request happened to complete the match. Two people matched into the
     same call must render the same call. */
  const mode = peer.mode || user.mode;
  const [secs, setSecs] = useState(0);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(mode === "video");
  const [chatOpen, setChatOpen] = useState(mode === "text");
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState("");
  const [breathe, setBreathe] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [camError, setCamError] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [listening, setListening] = useState(false);

  const [hasRemoteStream, setHasRemoteStream] = useState(false);

  const videoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const streamRef = useRef(null);
  const pcRef = useRef(null);
  const chatEndRef = useRef(null);
  const recogRef = useRef(null);
  const callChannelRef = useRef(null);

  const useVideo = mode === "video";
  const useAudioDevice = mode !== "text";

  useEffect(() => { streamRef.current?.getAudioTracks().forEach((tr) => (tr.enabled = !muted)); }, [muted]);
  useEffect(() => { streamRef.current?.getVideoTracks().forEach((tr) => (tr.enabled = camOn)); }, [camOn]);

  useEffect(() => {
    const i = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs, chatOpen]);

  /* One combined setup for the whole call session: local media, the
     Pusher channel (chat + WebRTC signaling), and — for voice/video
     calls — the actual peer-to-peer audio/video connection. Kept in one
     effect so local media is guaranteed ready before it's attached to
     the peer connection, rather than racing two separate effects.

     Messages and signaling both travel over a private Pusher channel
     scoped to this one call — /api/pusher-auth only signs it for the two
     accounts the /api/queue match created it for. Pusher's own "client
     events" carry data directly between the two browsers without another
     server round trip; the channel must have client events enabled in
     the Pusher dashboard for that app. WebRTC itself (once connected)
     carries audio/video directly, peer-to-peer — Pusher only ever
     carries the handshake (SDP offer/answer, ICE candidates), never the
     media itself. */
  useEffect(() => {
    if (!peer.callId) return;
    let cancelled = false;
    let channel = null;
    let pc = null;
    const client = getPusherClient();
    const onMessage = (data) => setMsgs((m) => [...m, { id: Date.now() + Math.random(), who: "peer", text: data.text }]);
    let onSignal = null;

    (async () => {
      if (mode !== "text") {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: useVideo });
          if (cancelled) { s.getTracks().forEach((x) => x.stop()); return; }
          streamRef.current = s;
          if (videoRef.current) videoRef.current.srcObject = s;
        } catch {
          if (!cancelled) {
            setCamError(true);
            notify("No camera or mic access — continuing without it.", "bad");
          }
        }
      }
      if (cancelled || !client) return;

      channel = client.subscribe(`private-call-${peer.callId}`);
      callChannelRef.current = channel;
      channel.bind("client-message", onMessage);

      if (mode === "text") return;

      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      streamRef.current?.getTracks().forEach((track) => pc.addTrack(track, streamRef.current));

      pc.onicecandidate = (e) => {
        if (e.candidate) channel.trigger("client-webrtc-signal", { kind: "ice", candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        setHasRemoteStream(true);
        const [remoteStream] = e.streams;
        if (useVideo) {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        } else if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
        }
      };

      /* ICE candidates can arrive before the remote description is set
         (perfectly normal — they're generated and sent independently);
         addIceCandidate throws if called too early, so queue them. */
      let remoteDescSet = false;
      let pending = [];
      onSignal = async (payload) => {
        try {
          if (payload.kind === "offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
            remoteDescSet = true;
            for (const c of pending) await pc.addIceCandidate(new RTCIceCandidate(c));
            pending = [];
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            channel.trigger("client-webrtc-signal", { kind: "answer", description: answer });
          } else if (payload.kind === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
            remoteDescSet = true;
            for (const c of pending) await pc.addIceCandidate(new RTCIceCandidate(c));
            pending = [];
          } else if (payload.kind === "ice" && payload.candidate) {
            if (remoteDescSet) await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            else pending.push(payload.candidate);
          }
        } catch (err) {
          console.error("Call setup error:", err);
        }
      };
      channel.bind("client-webrtc-signal", onSignal);

      /* Deterministic offerer — no extra coordination needed since the
         match already tells each side its role. Wait for the channel
         subscription to actually be confirmed before sending anything:
         a client event triggered before that can silently go nowhere. */
      if (peer.myRole === "seeker") {
        channel.bind("pusher:subscription_succeeded", async function onSub() {
          channel.unbind("pusher:subscription_succeeded", onSub);
          if (cancelled) return;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channel.trigger("client-webrtc-signal", { kind: "offer", description: offer });
        });
      }
    })();

    return () => {
      cancelled = true;
      if (channel) {
        channel.unbind("client-message", onMessage);
        if (onSignal) channel.unbind("client-webrtc-signal", onSignal);
        client?.unsubscribe(`private-call-${peer.callId}`);
      }
      callChannelRef.current = null;
      pc?.close();
      pcRef.current = null;
      streamRef.current?.getTracks().forEach((x) => x.stop());
    };
  }, [peer.callId, peer.myRole, mode, useVideo, notify]);

  /* real browser speech recognition where supported */
  const toggleDictation = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return notify("This browser doesn't support speech input. Chrome does.", "bad");
    if (listening) { recogRef.current?.stop(); setListening(false); return; }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e) => setDraft((d) => (d ? d + " " : "") + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); notify("Couldn't hear anything.", "bad"); };
    recogRef.current = r;
    r.start();
    setListening(true);
  };

  const send = () => {
    const text = sanitize(draft.trim(), 2000);
    if (!text) return;
    setMsgs((m) => [...m, { id: Date.now(), who: "me", text }]);
    setDraft("");
    callChannelRef.current?.trigger("client-message", { text });
  };

  const Tile = ({ label, self }) => {
    /* Both video elements are always mounted and only hidden via CSS,
       never conditionally rendered — a conditionally-mounted element
       loses whatever was attached to it (srcObject) the moment it
       unmounts, so toggling the camera off and back on, or the remote
       track arriving after the element would've been skipped, would
       both show a blank tile instead of the stream that's actually
       there. Hiding leaves the element (and its stream) intact. */
    const showVideo = self ? camOn && !camError : useVideo && hasRemoteStream;
    return (
      <div className={clsx("relative flex aspect-video items-center justify-center overflow-hidden rounded-3xl border bg-indigo-950", t.border)}>
        {self ? (
          <video ref={videoRef} autoPlay playsInline muted className={clsx("h-full w-full object-cover", !showVideo && "hidden")} />
        ) : useVideo ? (
          <video ref={remoteVideoRef} autoPlay playsInline className={clsx("h-full w-full object-cover", !showVideo && "hidden")} />
        ) : null}
        {!showVideo && (
          <div className={clsx("absolute inset-0 flex items-center justify-center font-serif text-2xl", self ? "bg-indigo-800 text-indigo-100" : "bg-indigo-950")}>
            <span className={clsx("flex h-20 w-20 items-center justify-center rounded-full",
              self ? "bg-indigo-800" : "bg-amber-200 text-indigo-950")}>
              {label[0]}
            </span>
          </div>
        )}
        <span className="absolute bottom-3 left-3 rounded-full bg-indigo-950 bg-opacity-70 px-2.5 py-1 text-xs text-indigo-100">
          {label}{self && muted ? " · muted" : ""}{!self && !hasRemoteStream ? " · connecting audio…" : ""}
        </span>
      </div>
    );
  };

  return (
    <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-emerald-300" />
          <p className="text-sm">{peer.handle} · <span className={t.faint}>{fmtTime(secs)}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <Button _t={t} size="sm" variant="ghost" onClick={onSafety}><Shield size={14} /> Crisis lines</Button>
          <Button _t={t} size="sm" variant="ghost" onClick={() => setReportOpen(true)}><Flag size={14} /> Report</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className={clsx("relative", chatOpen ? "lg:col-span-2" : "lg:col-span-3")}>
          <div className={clsx("grid gap-4", useVideo ? "sm:grid-cols-2" : "")}>
            <Tile label={peer.handle} />
            {useVideo && <Tile label={user.handle} self />}
          </div>
          {!useVideo && mode !== "text" && <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />}
          {breathe && <Breathing t={t} onClose={() => setBreathe(false)} />}
          {prompt && (
            <div className={clsx("mt-4 flex items-start justify-between gap-4 rounded-2xl border p-4", t.surface, t.border)}>
              <p className="font-serif text-lg leading-snug">{prompt}</p>
              <button onClick={() => setPrompt(null)} className={clsx("rounded-full p-1", t.hover)}><X size={16} /></button>
            </div>
          )}
        </div>

        <div className={clsx("relative flex flex-col rounded-3xl border h-[26rem] lg:h-auto", t.surface, t.border, !chatOpen && "hidden")}>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.map((m) => (
              <div key={m.id} className={clsx("flex", m.who === "me" ? "justify-end" : "justify-start")}>
                <p className={clsx("max-w-[75%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  m.who === "me" ? "bg-amber-200 text-indigo-950"
                    : m.who === "system" ? "bg-rose-500 text-white" : t.sunken)}>
                  {m.text}
                </p>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className={clsx("flex items-center gap-2 border-t p-3", t.border)}>
            <button onClick={toggleDictation} aria-label="Dictate"
              className={clsx("rounded-full p-2.5", listening ? "bg-rose-500 text-white" : clsx(t.sunken, t.hover))}>
              <Mic size={16} />
            </button>
            <Input t={t} value={draft} maxLength={2000}
              placeholder="Type instead of speaking"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()} />
            <Button _t={t} size="sm" onClick={send} disabled={!draft.trim()} aria-label="Send">
              <Send size={15} />
            </Button>
          </div>
        </div>
      </div>

      <div className={clsx("mt-6 flex flex-wrap items-center justify-center gap-2 rounded-full border p-2", t.surface, t.border)}>
        {useAudioDevice && (
          <Button _t={t} variant={muted ? "danger" : "ghost"} onClick={() => setMuted(!muted)}>
            {muted ? <MicOff size={16} /> : <Mic size={16} />} {muted ? "Unmute" : "Mute"}
          </Button>
        )}
        {useVideo && (
          <Button _t={t} variant={camOn ? "ghost" : "danger"} onClick={() => setCamOn(!camOn)}>
            {camOn ? <Video size={16} /> : <VideoOff size={16} />} Camera
          </Button>
        )}
        <Button _t={t} variant="ghost" onClick={() => setChatOpen(!chatOpen)}><MessageSquare size={16} /> Chat</Button>
        <Button _t={t} variant="ghost" onClick={() => setBreathe(true)}><Wind size={16} /> Breathe</Button>
        <Button _t={t} variant="ghost" onClick={() => setPrompt(pick(PROMPTS))}><Sparkles size={16} /> Prompt</Button>
        <Button _t={t} variant="ghost" onClick={() => onEnd(secs, true)}><SkipForward size={16} /> Skip</Button>
        <Button _t={t} variant="danger" onClick={() => onEnd(secs, false)}>
          <PhoneOff size={16} /> End
        </Button>
      </div>

      <Modal t={t} open={reportOpen} onClose={() => setReportOpen(false)} title={`Report ${peer.handle}`}>
        <p className={clsx("text-sm leading-relaxed", t.muted)}>
          Reports go to a moderator and end the call immediately. {peer.handle} isn't told who reported them.
        </p>
        <div className="mt-5 space-y-2">
          {["Harassment or abuse", "Sexual content", "Trying to get personal details", "Selling something", "Someone is in danger"].map((r) => (
            <button key={r}
              onClick={async () => {
                setReportOpen(false);
                try {
                  await api("/api/reports", { method: "POST", body: { reason: r, reportedHandle: peer.handle, callId: peer.callId } });
                  notify("Report sent. The call has ended.", "bad");
                } catch (e) {
                  notify(e.message, "bad");
                }
                onEnd(secs, true);
              }}
              className={clsx("flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm", t.sunken, t.hover)}>
              {r} <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------- post-call ------------------------------- */

function PostCall({ t, peer, seconds, onSave, onAgain, onHome }) {
  const [rating, setRating] = useState(0);
  const [kudos, setKudos] = useState([]);
  const [note, setNote] = useState("");
  const [blocked, setBlocked] = useState(false);

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <h1 className="font-serif text-3xl leading-tight">That was {fmtTime(seconds)} with {peer.handle}.</h1>
      <p className={clsx("mt-3 text-sm leading-relaxed", t.muted)}>
        The conversation itself wasn't saved. Anything you write below is yours alone.
      </p>

      <div className="mt-8 space-y-7">
        <div>
          <p className="mb-3 text-sm font-medium">How did it feel?</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} onClick={() => setRating(v)} aria-label={`${v} stars`}
                className={clsx("flex-1 rounded-xl py-3", v <= rating ? "bg-amber-200 text-indigo-950" : clsx(t.sunken, t.hover))}>
                <Star size={18} className="mx-auto" fill={v <= rating ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium">Send {peer.handle} some kudos</p>
          <div className="flex flex-wrap gap-2">
            {KUDOS.map((k) => (
              <Chip key={k} t={t} active={kudos.includes(k)}
                onClick={() => setKudos((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))}>{k}</Chip>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">A note to yourself</p>
          <textarea rows={4} value={note} maxLength={2000}
            onChange={(e) => setNote(e.target.value.slice(0, 2000))}
            placeholder="What do you want to remember from this?"
            className={clsx("w-full resize-none rounded-xl border px-4 py-3 text-sm outline-none focus:border-amber-300", t.input)} />
        </div>

        <button onClick={() => setBlocked(!blocked)}
          className={clsx("flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm",
            blocked ? "border-rose-400 text-rose-400" : t.border, t.hover)}>
          <Ban size={16} /> {blocked ? `You won't be matched with ${peer.handle} again` : `Don't match me with ${peer.handle} again`}
        </button>
      </div>

      <div className="mt-9 flex flex-wrap gap-3">
        <Button _t={t} size="lg" onClick={() => onSave({ rating, kudos, note: sanitize(note), blocked }, onAgain)}>
          Talk again
        </Button>
        <Button _t={t} size="lg" variant="ghost" onClick={() => onSave({ rating, kudos, note: sanitize(note), blocked }, onHome)}>
          That's enough for tonight
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------- training -------------------------------- */

function Training({ t, user, setUser, onBack, notify }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(user.trainingDone || []);
  const lesson = TRAINING[i];

  const mark = async () => {
    const next = done.includes(i) ? done : [...done, i];
    setDone(next);
    try { await api("/api/account", { method: "PATCH", body: { trainingDone: next } }); } catch { /* best effort */ }
    if (i < TRAINING.length - 1) setI(i + 1);
    else if (next.length === TRAINING.length) {
      try {
        const { account } = await api("/api/account", { method: "PATCH", body: { trained: true } });
        setUser(account);
      } catch (e) {
        notify(e.message, "bad");
        return;
      }
      notify("Training complete. You can take calls now.");
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <button onClick={onBack} className={clsx("mb-8 inline-flex items-center gap-2 text-sm", t.faint)}>
        <ArrowLeft size={15} /> Home
      </button>

      <h1 className="font-serif text-3xl leading-tight sm:text-4xl">Listening well is a skill, not a personality trait.</h1>
      <p className={clsx("mt-3 text-sm leading-relaxed", t.muted)}>Five short lessons. Finish all five to unlock taking calls.</p>

      <div className="mt-10 grid gap-8 sm:grid-cols-3">
        <ol className="space-y-1">
          {TRAINING.map((l, idx) => (
            <li key={l.title}>
              <button onClick={() => setI(idx)}
                className={clsx("flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                  idx === i ? "bg-amber-200 text-indigo-950" : t.hover)}>
                <span className={clsx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs",
                  done.includes(idx) ? "bg-emerald-300 text-indigo-950" : idx === i ? "bg-indigo-950 text-amber-200" : t.chip)}>
                  {done.includes(idx) ? <Check size={12} strokeWidth={3} /> : idx + 1}
                </span>
                <span className="leading-snug">{l.title}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className={clsx("rounded-3xl border p-6 sm:col-span-2", t.surface, t.border)}>
          <h2 className="font-serif text-2xl leading-tight">{lesson.title}</h2>
          <p className="mt-4 text-base leading-relaxed">{lesson.body}</p>
          <div className="mt-7 flex items-center justify-between">
            <Button _t={t} variant="quiet" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>
              <ChevronLeft size={16} /> Previous
            </Button>
            <Button _t={t} onClick={mark}>{done.includes(i) ? "Next" : "Mark as read"} <ChevronRight size={16} /></Button>
          </div>
        </div>
      </div>

      {user.trained && (
        <div className={clsx("mt-8 flex items-center gap-4 rounded-2xl border p-5", t.surface, t.border)}>
          <UserCheck size={22} className="text-emerald-300" />
          <p className="text-sm leading-relaxed">
            You're a trained listener. Stepping away is expected — there's no minimum.
          </p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- settings -------------------------------- */

function Settings({ t, user, setUser, blocked, setBlocked, dark, setDark, onBack, onSignOut, onDeleted, notify }) {
  const patch = async (fields) => {
    setUser((u) => ({ ...u, ...fields }));
    try {
      const { account } = await api("/api/account", { method: "PATCH", body: fields });
      setUser(account);
    } catch (e) {
      notify(e.message, "bad");
    }
  };

  const unblock = async (accountId) => {
    setBlocked((v) => v.filter((x) => x.accountId !== accountId));
    try {
      await api(`/api/blocked?accountId=${encodeURIComponent(accountId)}`, { method: "DELETE" });
    } catch (e) {
      notify(e.message, "bad");
    }
  };

  const deleteAccount = async () => {
    try {
      await api("/api/account", { method: "DELETE" });
      onDeleted();
    } catch (e) {
      notify(e.message, "bad");
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <button onClick={onBack} className={clsx("mb-8 inline-flex items-center gap-2 text-sm", t.faint)}>
        <ArrowLeft size={15} /> Home
      </button>
      <h1 className="font-serif text-3xl leading-tight sm:text-4xl">Settings</h1>

      <div className="mt-8 space-y-6">
        <section className={clsx("rounded-3xl border p-6", t.surface, t.border)}>
          <h2 className="font-serif text-xl">Who you are here</h2>
          <div className="mt-5 space-y-5">
            <Field t={t} label="Handle">
              <Input t={t} value={user.handle} maxLength={18}
                onChange={(e) => setUser((u) => ({ ...u, handle: sanitize(e.target.value, 18) }))}
                onBlur={(e) => patch({ handle: sanitize(e.target.value, 18) })} />
            </Field>
            <div>
              <p className="mb-2.5 text-sm font-medium">Language</p>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((l) => (
                  <Chip key={l} t={t} active={user.lang === l} onClick={() => patch({ lang: l })}>{l}</Chip>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={clsx("rounded-3xl border p-6", t.surface, t.border)}>
          <h2 className="font-serif text-xl">Calls</h2>
          <div className="mt-5 space-y-4">
            {[
              ["Blur my video by default", "blurVideo"],
              ["Let me be matched with new listeners", "newListeners"],
              ["Show conversation prompts", "prompts"],
              ["Warn me at 45 minutes", "timeWarn"],
            ].map(([label, key]) => (
              <button key={key} onClick={() => patch({ [key]: !user[key] })}
                className="flex w-full items-center justify-between gap-4 text-left">
                <span className="text-sm">{label}</span>
                <span className={clsx("relative h-6 w-11 shrink-0 rounded-full transition-colors", user[key] ? "bg-amber-300" : t.sunken)}>
                  <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", user[key] ? "left-[1.375rem]" : "left-0.5")} />
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className={clsx("rounded-3xl border p-6", t.surface, t.border)}>
          <h2 className="font-serif text-xl">Appearance</h2>
          <div className="mt-4 flex gap-2">
            <Chip t={t} icon={Moon} active={dark} onClick={() => setDark(true)}>Night</Chip>
            <Chip t={t} icon={Sun} active={!dark} onClick={() => setDark(false)}>Day</Chip>
          </div>
        </section>

        <section className={clsx("rounded-3xl border p-6", t.surface, t.border)}>
          <h2 className="font-serif text-xl">Blocked</h2>
          {blocked.length === 0 ? (
            <p className={clsx("mt-3 text-sm leading-relaxed", t.faint)}>Nobody blocked.</p>
          ) : (
            <ul className={clsx("mt-4 divide-y", t.border)}>
              {blocked.map((b) => (
                <li key={b.accountId} className="flex items-center justify-between py-3 text-sm">
                  {b.handle}
                  <button onClick={() => unblock(b.accountId)}
                    className="underline underline-offset-4">Unblock</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={clsx("rounded-3xl border p-6", t.surface, t.border)}>
          <h2 className="font-serif text-xl">Account</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button _t={t} variant="ghost" onClick={onSignOut}><LogOut size={16} /> Sign out</Button>
            <Button _t={t} variant="danger" onClick={deleteAccount}>
              <Trash2 size={16} /> Delete account
            </Button>
          </div>
          <p className={clsx("mt-4 text-sm leading-relaxed", t.faint)}>
            Deleting removes your email, handle, preferences, and private notes. Conversations were never stored.
          </p>
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------- app ----------------------------------- */

export default function App() {
  const [dark, setDark] = useState(true);
  const t = useTheme(dark);

  const [checking, setChecking] = useState(true);
  const [screen, setScreen] = useState("landing");
  const [user, setUser] = useState(null);
  const [draft, setDraft] = useState({ role: "", topics: [], mode: "voice", lang: "English", handle: "" });
  const [listenerRequested, setListenerRequested] = useState(false);

  const [peer, setPeer] = useState(null);
  const [lastSeconds, setLastSeconds] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [moods, setMoods] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [presence, setPresence] = useState({ listenersOnline: null, medianWaitSeconds: null });
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((text, kind = "good") => {
    const id = Date.now() + Math.random();
    setToasts((v) => [...v, { id, text, kind }]);
    setTimeout(() => setToasts((v) => v.filter((x) => x.id !== id)), 4500);
  }, []);
  const dismiss = (id) => setToasts((v) => v.filter((x) => x.id !== id));
  const nav = useCallback((to) => setScreen(to), []);

  /* Restore a signed-in session on load (the cookie survives a refresh
     even though nothing else here does), and keep the landing page's
     presence numbers current whether or not anyone's signed in. */
  useEffect(() => {
    (async () => {
      try {
        const { account } = await api("/api/auth/me");
        if (account) { setUser(account); nav("home"); }
      } catch { /* not signed in */ }
      setChecking(false);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const p = await api("/api/presence");
        if (!cancelled) setPresence(p);
      } catch { /* leave the empty state showing */ }
    };
    load();
    const i = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  /* Once signed in, pull in what's actually been persisted for this
     account: past sessions, mood check-ins, and anyone blocked. */
  useEffect(() => {
    if (!user) { setSessions([]); setMoods([]); setBlocked([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const [s, m, b] = await Promise.all([
          api("/api/sessions"), api("/api/moods"), api("/api/blocked"),
        ]);
        if (cancelled) return;
        setSessions(s.sessions);
        setMoods(m.moods);
        setBlocked(b.blocked);
      } catch (e) {
        if (!cancelled) notify(e.message, "bad");
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, notify]);

  const handleAuthed = (acct, isNew) => {
    if (isNew) {
      setDraft((d) => ({ ...d, email: acct.email, pw: acct.pw, age18: acct.age18, handle: pick(HANDLES) }));
      nav("onboarding");
    } else {
      setUser(acct);
      nav("home");
    }
  };

  const finishOnboarding = async () => {
    try {
      const { account } = await api("/api/auth/signup", {
        method: "POST",
        body: {
          email: draft.email, password: draft.pw, handle: draft.handle.trim(),
          role: draft.role, topics: draft.topics, mode: draft.mode, lang: draft.lang,
          age18: draft.age18,
        },
      });
      setUser(account);
      nav("home");
    } catch (e) {
      notify(e.message, "bad");
      nav("auth");
    }
  };

  const takeCall = () => { setListenerRequested(true); nav("queue"); };
  const matchHuman = () => { setListenerRequested(false); nav("queue"); };

  const onMatched = useCallback(({ peer: matchedPeer, callId, mode, myRole }) => {
    setPeer({ ...matchedPeer, callId, mode, myRole });
    nav("consent");
  }, [nav]);

  const endCall = (seconds, skipReview) => {
    setLastSeconds(seconds);
    nav(skipReview ? "home" : "postcall");
  };

  const saveSession = async ({ rating, kudos, note, blocked: b }, then) => {
    const mode = peer.mode || user.mode;
    try {
      const { session } = await api("/api/sessions", {
        method: "POST",
        body: { peer: peer.handle, mode, seconds: lastSeconds, rating, kudos, note },
      });
      setSessions((s) => [...s, session]);
      if (b && peer.id && !blocked.some((x) => x.accountId === peer.id)) {
        await api("/api/blocked", { method: "POST", body: { accountId: peer.id, handle: peer.handle } });
        setBlocked((v) => [...v, { accountId: peer.id, handle: peer.handle }]);
      }
    } catch (e) {
      notify(e.message, "bad");
    }
    then();
  };

  const signOut = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* clear locally regardless */ }
    setUser(null);
    nav("landing");
    notify("Signed out.");
  };

  const onDeleted = () => {
    setUser(null);
    nav("landing");
    notify("Account deleted.");
  };

  return (
    <div className={clsx("min-h-screen font-sans antialiased", t.app)}>
      <header className={clsx("sticky top-0 z-40 border-b", t.border, t.app)}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button onClick={() => nav(user ? "home" : "landing")} aria-label="Late Hours home">
            <Logo size={26} />
          </button>
          <nav className="flex items-center gap-1.5">
            <button onClick={() => setDark(!dark)} aria-label="Switch theme" className={clsx("rounded-full p-2", t.hover)}>
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button onClick={() => setSafetyOpen(true)} aria-label="Crisis resources" className={clsx("rounded-full p-2", t.hover)}>
              <Shield size={17} />
            </button>
            {user ? (
              <>
                <button onClick={() => nav("settings")} aria-label="Settings" className={clsx("rounded-full p-2", t.hover)}>
                  <Cog size={17} />
                </button>
                <span className={clsx("ml-1 hidden rounded-full px-3 py-1.5 text-sm sm:inline", t.chip)}>{user.handle}</span>
              </>
            ) : (
              screen === "landing" && <Button _t={t} size="sm" onClick={() => nav("auth")}>Sign in</Button>
            )}
          </nav>
        </div>
      </header>

      <main>
        {checking ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <Loader size={22} className={clsx("animate-spin", t.faint)} />
          </div>
        ) : (
          <>
            {screen === "landing" && <Landing t={t} onStart={() => nav("auth")} onSafety={() => setSafetyOpen(true)} presence={presence} />}
            {screen === "auth" && <Auth t={t} onAuthed={handleAuthed} notify={notify} onBack={() => nav("landing")} />}
            {screen === "onboarding" && <Onboarding t={t} draft={draft} setDraft={setDraft} onDone={finishOnboarding} notify={notify} />}
            {screen === "home" && user && (
              <Home t={t} user={user} setUser={setUser} sessions={sessions} moods={moods}
                onMood={async (v) => {
                  try {
                    const { mood } = await api("/api/moods", { method: "POST", body: { v } });
                    setMoods((m) => [...m, mood]);
                  } catch (e) { notify(e.message, "bad"); }
                }}
                onMatchHuman={matchHuman} onTakeCall={takeCall}
                onTraining={() => nav("training")} onSafety={() => setSafetyOpen(true)} presence={presence} notify={notify} />
            )}
            {screen === "queue" && user && (
              <Queue t={t} user={user} role={listenerRequested ? "listener" : "seeker"} onMatched={onMatched}
                onCancel={() => nav("home")} presence={presence} notify={notify} />
            )}
            {screen === "consent" && user && peer && (
              <Consent t={t} peer={peer} user={user} onAccept={() => nav("call")} onCancel={() => nav("home")} />
            )}
            {screen === "call" && user && peer && (
              <Call t={t} user={user} peer={peer} onEnd={endCall} notify={notify} onSafety={() => setSafetyOpen(true)} />
            )}
            {screen === "postcall" && peer && (
              <PostCall t={t} peer={peer} seconds={lastSeconds} onSave={saveSession}
                onAgain={() => nav("queue")} onHome={() => nav("home")} />
            )}
            {screen === "training" && user && <Training t={t} user={user} setUser={setUser} onBack={() => nav("home")} notify={notify} />}
            {screen === "settings" && user && (
              <Settings t={t} user={user} setUser={setUser} blocked={blocked} setBlocked={setBlocked}
                dark={dark} setDark={setDark} onBack={() => nav("home")}
                onSignOut={signOut} onDeleted={onDeleted} notify={notify} />
            )}
          </>
        )}
      </main>

      <Modal t={t} open={safetyOpen} onClose={() => setSafetyOpen(false)} wide title="If you need help right now">
        <p className={clsx("text-sm leading-relaxed", t.muted)}>
          Late Hours isn't an emergency service. Human listeners aren't clinicians. If you or someone
          else is in immediate danger, contact one of these instead.
        </p>
        <ul className={clsx("mt-5 divide-y", t.border)}>
          {RESOURCES.map((r) => (
            <li key={r.name} className="py-3.5">
              <p className="text-sm font-medium">{r.name}</p>
              <p className={clsx("mt-0.5 text-sm", t.faint)}>{r.detail}</p>
              <p className={clsx("mt-0.5 text-xs", t.faint)}>{r.region}</p>
            </li>
          ))}
        </ul>
      </Modal>

      <Toasts items={toasts} dismiss={dismiss} />

      <footer className={clsx("mt-16 border-t px-6 py-10", t.border)}>
        <div className="mx-auto max-w-6xl">
          <Logo size={22} className={t.faint} />
          <p className={clsx("mt-3 max-w-2xl text-sm leading-relaxed", t.faint)}>
            Peer support, not treatment. Human listeners are volunteers who completed a short listening
            course. They can't diagnose, prescribe, or manage a crisis.
          </p>
          <p className={clsx("mt-6 text-xs", t.faint)}>Built by Vexoro team</p>
        </div>
      </footer>
    </div>
  );
}