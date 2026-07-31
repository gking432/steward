"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  Download,
  Eye,
  FileText,
  Flag,
  Gauge,
  HelpCircle,
  Home,
  Landmark,
  Lightbulb,
  ListChecks,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createEmptyState } from "../lib/initial-state";
import {
  calculateTradeoffs,
  daysUntil,
  deterministicCategory,
  money,
  paycheckAllocation,
  spendingByCategory,
} from "../lib/engine";
import { suggestBudgets } from "../lib/financial-import";
import type {
  Account,
  AccountType,
  Bill,
  Goal,
  NavView,
  Project,
  Recommendation,
  StewardState,
  Transaction,
  Budget,
  WishlistItem,
} from "../lib/steward-types";

const navItems: {
  id: NavView;
  label: string;
  icon: typeof Home;
}[] = [
  { id: "home", label: "Today", icon: Home },
  { id: "plan", label: "Plan", icon: ListChecks },
  { id: "transactions", label: "Transactions", icon: WalletCards },
  { id: "projects", label: "Projects", icon: BriefcaseBusiness },
  { id: "wishlist", label: "Wishlist", icon: ShoppingBag },
  { id: "advisor", label: "Advisor", icon: MessageCircle },
  { id: "reviews", label: "Reviews", icon: FileText },
  { id: "accounts", label: "Accounts", icon: Landmark },
  { id: "settings", label: "Settings", icon: Settings },
];

const categories = [
  "Housing",
  "Utilities",
  "Groceries",
  "Transportation",
  "Insurance",
  "Healthcare",
  "Debt payments",
  "Dining",
  "Shopping",
  "Entertainment",
  "Travel",
  "Personal care",
  "Hobbies",
  "Education",
  "Savings",
  "Projects",
  "Transfers",
  "Uncategorized",
];

type ModalName =
  | "account"
  | "transaction"
  | "project"
  | "wishlist"
  | "goal"
  | "bill"
  | "onboarding"
  | "delete"
  | null;

type ChatMessage = {
  id: string;
  role: "user" | "advisor";
  text: string;
  detail?: string;
};

declare global {
  interface Window {
    Plaid?: {
      create(config: {
        token: string;
        onSuccess: (
          publicToken: string,
          metadata: {
            institution?: { institution_id?: string; name?: string };
          },
        ) => void;
        onExit?: () => void;
      }): { open(): void };
    };
  }
}

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function Progress({
  value,
  tone = "green",
}: {
  value: number;
  tone?: "green" | "blue" | "amber";
}) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span
        className={`progress-fill ${tone}`}
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Home;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={22} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

function Modal({
  title,
  eyebrow,
  children,
  onClose,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function BankConnectGate({
  name,
  status,
  error,
  connect,
  loading,
}: {
  name: string;
  status: "idle" | "opening" | "importing" | "syncing";
  error: string;
  connect: () => void;
  loading?: boolean;
}) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const busy = loading || status !== "idle";
  const label = loading
    ? "Opening your workspace…"
    : status === "opening"
      ? "Opening secure connection…"
      : status === "importing"
        ? "Saving your accounts…"
        : status === "syncing"
          ? "Importing transactions…"
          : "Connect your bank";
  return (
    <main className="connect-gate">
      <div className="connect-desktop">
        <div className="connect-brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <strong>Steward</strong>
        </div>
        <section className="connect-card">
          <span className="connect-lock">
            <Landmark size={25} />
          </span>
          <span className="eyebrow">Your money, without the setup work</span>
          <h1>
            {loading
              ? "Getting Steward ready"
              : `Connect once, ${name.split(" ")[0] || "then"} let Steward organize the rest.`}
          </h1>
          <p>
            Link your bank securely to import real balances and transactions.
            Steward starts empty—there is no sample data to delete.
          </p>
          <button
            className="primary-button connect-button"
            onClick={connect}
            disabled={busy}
          >
            {busy ? (
              <RefreshCw className="spin" size={18} />
            ) : (
              <Landmark size={18} />
            )}
            {label}
          </button>
          {error && (
            <div className="connect-error" role="alert">
              <HelpCircle size={17} />
              <span>{error}</span>
            </div>
          )}
          <div className="connect-trust">
            <span>
              <ShieldCheck size={17} />
              Bank credentials are handled by Plaid, never Steward.
            </span>
            <span>
              <Eye size={17} />
              Read-only access. Steward cannot move money.
            </span>
          </div>
        </section>
        <small className="connect-foot">
          Private by default · Disconnect and delete your data at any time
        </small>
      </div>

      <section className={cx("connect-mobile", loading && "is-launching")}>
        {loading ? (
          <div className="ios-launch-state" role="status">
            <div className="ios-app-icon" aria-hidden="true">
              <div className="brand-mark">
                <span />
                <span />
                <span />
              </div>
            </div>
            <strong>Steward</strong>
            <small>Your financial OS</small>
            <RefreshCw className="spin" size={17} />
          </div>
        ) : (
          <>
            <header className="ios-onboarding-bar">
              <div className="ios-wordmark">
                <div className="brand-mark" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <strong>Steward</strong>
              </div>
              <button onClick={() => setPrivacyOpen(true)}>Privacy</button>
            </header>

            <div className="ios-onboarding-scroll">
              <div className="ios-progress" aria-label="Setup step 1 of 1">
                <span />
                <small>SET UP · 1 OF 1</small>
              </div>
              <div className="ios-onboarding-copy">
                <h1>Start with the money you already have.</h1>
                <p>
                  Connect your accounts once. Steward turns the activity into a
                  clear plan—without asking you to build one from scratch.
                </p>
              </div>

              <div className="ios-account-preview" aria-hidden="true">
                <div className="ios-preview-top">
                  <span>YOUR FINANCIAL PICTURE</span>
                  <ShieldCheck size={18} />
                </div>
                <strong>Ready when you are</strong>
                <p>Balances · bills · spending · cash flow</p>
                <div className="ios-account-stack">
                  <span><Landmark size={17} /></span>
                  <span><WalletCards size={17} /></span>
                  <span><TrendingUp size={17} /></span>
                  <i />
                </div>
              </div>

              <div className="ios-permission-group">
                <div>
                  <span className="ios-permission-icon"><Landmark size={18} /></span>
                  <p><strong>Accounts and balances</strong><small>Know what is available now</small></p>
                  <Check size={17} />
                </div>
                <div>
                  <span className="ios-permission-icon"><WalletCards size={18} /></span>
                  <p><strong>Transaction history</strong><small>Understand where money is going</small></p>
                  <Check size={17} />
                </div>
                <div>
                  <span className="ios-permission-icon"><Sparkles size={18} /></span>
                  <p><strong>Your next best move</strong><small>Build guidance from real activity</small></p>
                  <Check size={17} />
                </div>
              </div>
            </div>

            <footer className="ios-connect-action">
              {error && (
                <div className="ios-connect-error" role="alert">
                  <HelpCircle size={16} />
                  <span>{error}</span>
                </div>
              )}
              <button onClick={connect} disabled={busy}>
                {busy ? <RefreshCw className="spin" size={18} /> : <Landmark size={18} />}
                {label}
              </button>
              <small><ShieldCheck size={13} /> Private and read-only</small>
            </footer>

            {privacyOpen && (
              <>
                <button
                  className="ios-sheet-scrim"
                  onClick={() => setPrivacyOpen(false)}
                  aria-label="Close privacy details"
                />
                <aside className="ios-privacy-sheet" role="dialog" aria-modal="true" aria-label="Privacy details">
                  <i className="ios-sheet-handle" />
                  <div className="ios-sheet-icon"><ShieldCheck size={25} /></div>
                  <h2>Your bank login stays with Plaid.</h2>
                  <p>
                    Steward receives read-only financial data. It cannot move
                    money, and you can disconnect and delete your workspace at
                    any time.
                  </p>
                  <button onClick={() => setPrivacyOpen(false)}>Done</button>
                </aside>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export function StewardApp({
  initialState,
}: {
  initialState: StewardState;
}) {
  const [state, setState] = useState(initialState);
  const [view, setView] = useState<NavView>("home");
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileMore, setMobileMore] = useState(false);
  const [modal, setModal] = useState<ModalName>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "offline"
  >("saving");
  const [bankStatus, setBankStatus] = useState<
    "idle" | "opening" | "importing" | "syncing"
  >("idle");
  const [bankError, setBankError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [advisorPrompt, setAdvisorPrompt] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "advisor",
      text: "Ask me about your cash, bills, spending, or next payday.",
      detail:
        "I use only the financial data you connect or enter, and I label estimates and assumptions.",
    },
  ]);
  const [transactionFilter, setTransactionFilter] = useState("All");
  const [selectedTransactions, setSelectedTransactions] = useState<string[]>([]);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const loadedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    fetch("/api/steward")
      .then((response) => response.json())
      .then((payload) => {
        if (payload.state) setState(payload.state);
        setSaveState(payload.mode === "fallback" ? "offline" : "saved");
      })
      .catch(() => setSaveState("offline"))
      .finally(() => {
        loadedRef.current = true;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const theme =
      state.profile.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : state.profile.theme;
    document.documentElement.dataset.theme = theme;
  }, [state.profile.theme]);

  useEffect(() => {
    if (!loadedRef.current) return;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/steward", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state),
      })
        .then((response) => {
          if (!response.ok) throw new Error("save failed");
          setSaveState("saved");
        })
        .catch(() => setSaveState("offline"));
    }, 650);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state]);

  const tradeoffs = useMemo(() => calculateTradeoffs(state), [state]);
  const allocation = useMemo(() => paycheckAllocation(state), [state]);
  const categorySpending = useMemo(
    () => spendingByCategory(state.transactions),
    [state.transactions],
  );
  const totalSavings = state.accounts
    .filter((account) => account.type === "Savings")
    .reduce((sum, account) => sum + account.balance, 0);
  const cardDebt = state.accounts
    .filter((account) => account.type === "Credit card")
    .reduce((sum, account) => sum + account.balance, 0);
  const activeRecommendations = state.recommendations.filter(
    (recommendation) => recommendation.status === "active",
  );

  const update = useCallback(
    <K extends keyof StewardState>(key: K, value: StewardState[K]) =>
      setState((current) => ({ ...current, [key]: value })),
    [],
  );

  const go = (next: NavView) => {
    setView(next);
    setMobileNav(false);
    setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const actOnRecommendation = (
    recommendation: Recommendation,
    action: "completed" | "dismissed" | "snoozed",
  ) => {
    setState((current) => ({
      ...current,
      recommendations: current.recommendations.map((item) =>
        item.id === recommendation.id ? { ...item, status: action } : item,
      ),
      paycheckPlan:
        recommendation.type === "debt" && action === "completed"
          ? {
              ...current.paycheckPlan,
              debt: Math.max(current.paycheckPlan.debt, recommendation.impact),
            }
          : current.paycheckPlan,
    }));
  };

  const advisorAnswer = (prompt: string) => {
    const lower = prompt.toLowerCase();
    const item = state.wishlist.find((wish) =>
      lower.includes(wish.name.toLowerCase()),
    );
    if (item || /afford|buy|purchase/.test(lower)) {
      const price = item?.price ?? Number(lower.match(/\$?(\d+)/)?.[1] ?? 0);
      const affordable = price > 0 && price <= tradeoffs.safeToSpend;
      return {
        text: affordable
          ? `Yes—you can spend ${money(price)} without interfering with bills, required debt payments, savings, or your ${money(state.profile.minimumBuffer)} checking buffer.`
          : price > 0
            ? `I’d wait. ${money(price)} is above today’s ${money(tradeoffs.safeToSpend)} safe-to-spend amount.`
            : `Your safe-to-spend amount is ${money(tradeoffs.safeToSpend)}. Tell me the item or price and I’ll compare it with your current priorities.`,
        detail: item
          ? item.reason
          : `Known: ${money(tradeoffs.liquidCash)} liquid cash and ${money(tradeoffs.billsBeforePayday)} of bills before payday. Assumption: no untracked obligations.`,
      };
    }
    if (/bill|due|obligation/.test(lower)) {
      const upcoming = state.bills
        .filter((bill) => !bill.paid)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 3);
      return {
        text: `Your next three bills total ${money(upcoming.reduce((sum, bill) => sum + bill.amount, 0))}: ${upcoming.map((bill) => `${bill.name} (${money(bill.amount)})`).join(", ")}.`,
        detail: "These values come from your bill records; autopay status is shown in Plan.",
      };
    }
    if (/dining|restaurant|food/.test(lower)) {
      const planned =
        state.budgets.find((budget) => budget.category === "Dining")?.planned ??
        0;
      return {
        text: `You’ve spent ${money(categorySpending.Dining ?? 0)} on dining in the last 30 days${planned ? ` against a ${money(planned)} recent monthly average` : ""}.`,
        detail: "This uses connected, categorized transactions only.",
      };
    }
    if (/paycheck|allocate|next pay/.test(lower)) {
      return {
        text: `For your next ${money(allocation.income)} paycheck, keep ${money(allocation.upcomingBills)} for upcoming bills, ${money(state.paycheckPlan.savings)} for savings, and ${money(state.paycheckPlan.debt)} for debt. Your current plan leaves ${money(allocation.remaining)} unassigned.`,
        detail:
          "The math is deterministic. You can adjust every allocation in Plan.",
      };
    }
    if (/why|low|changed/.test(lower)) {
      return {
        text: `Your current safe-to-spend calculation starts with ${money(tradeoffs.liquidCash)}, then protects ${money(tradeoffs.billsBeforePayday)} in upcoming bills and your ${money(state.profile.minimumBuffer)} cash buffer.`,
        detail:
          "Connected balances and recorded obligations drive this result; pending activity can still change it.",
      };
    }
    const firstRecommendation = activeRecommendations[0];
    return {
      text: firstRecommendation
        ? `${firstRecommendation.title}. ${firstRecommendation.description}`
        : "Your connected data does not show an urgent action right now.",
      detail:
        firstRecommendation?.reason ??
        "Steward will update this when balances or transactions change.",
    };
  };

  const sendAdvisor = async (prompt = advisorPrompt) => {
    const clean = prompt.trim();
    if (!clean) return;
    const fallback = advisorAnswer(clean);
    setChat((current) => [
      ...current,
      { id: uid("chat"), role: "user", text: clean },
    ]);
    setAdvisorPrompt("");
    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: clean,
          deterministicAnswer: fallback.text,
          context: {
            safeToSpend: tradeoffs.safeToSpend,
            availableCash: tradeoffs.liquidCash,
            billsBeforePayday: tradeoffs.billsBeforePayday,
            minimumBuffer: state.profile.minimumBuffer,
            nextPayday: state.profile.nextPayday,
            goals: state.goals.map((goal) => ({
              name: goal.name,
              target: goal.target,
              current: goal.current,
            })),
            wishlist: state.wishlist.map((item) => ({
              name: item.name,
              price: item.price,
              status: item.status,
            })),
          },
        }),
      });
      const payload = await response.json();
      const enhanced =
        payload.enhanced && payload.explanation
          ? {
              text: payload.explanation.answer,
              detail: `${payload.explanation.rationale}${
                payload.explanation.assumptions?.length
                  ? ` Assumptions: ${payload.explanation.assumptions.join("; ")}`
                  : ""
              }`,
            }
          : fallback;
      setChat((current) => [
        ...current,
        { id: uid("chat"), role: "advisor", ...enhanced },
      ]);
    } catch {
      setChat((current) => [
        ...current,
        { id: uid("chat"), role: "advisor", ...fallback },
      ]);
    }
  };

  const askAboutItem = (item: WishlistItem) => {
    go("advisor");
    const prompt = `Can I afford the ${item.name} for ${money(item.price)}?`;
    void sendAdvisor(prompt);
  };

  const connectPlaid = async () => {
    setBankError("");
    setBankStatus("opening");
    try {
      const tokenResponse = await fetch("/api/plaid/link-token", {
        method: "POST",
      });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenPayload.linkToken) {
        setBankError(
          tokenPayload.error ?? "Bank connections are not available right now.",
        );
        setBankStatus("idle");
        return;
      }
      if (!window.Plaid) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>(
            'script[src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"]',
          );
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(), { once: true });
            return;
          }
          const script = document.createElement("script");
          script.src =
            "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject();
          document.head.appendChild(script);
        });
      }
      window.Plaid?.create({
        token: tokenPayload.linkToken,
        onSuccess: async (publicToken, metadata) => {
          setBankStatus("importing");
          const response = await fetch("/api/plaid/exchange", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              publicToken,
              institutionId: metadata.institution?.institution_id,
              institutionName: metadata.institution?.name,
            }),
          });
          const payload = await response.json();
          if (!response.ok) {
            setBankError(payload.error ?? "The connection could not be saved.");
            setBankStatus("idle");
            return;
          }
          if (payload.state) setState(payload.state);
          setBankStatus("syncing");
          const syncResponse = await fetch("/api/plaid/sync", {
            method: "POST",
          });
          const syncPayload = await syncResponse.json();
          if (syncPayload.state) setState(syncPayload.state);
          if (!syncResponse.ok) {
            setBankError(
              syncPayload.error ??
                "Your accounts connected, but transaction history is still pending.",
            );
          }
          setBankStatus("idle");
        },
        onExit: () => setBankStatus("idle"),
      }).open();
    } catch {
      setBankError("Steward could not open the secure bank connection.");
      setBankStatus("idle");
    }
  };

  const syncBank = async () => {
    setBankError("");
    setBankStatus("syncing");
    try {
      const response = await fetch("/api/plaid/sync", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Sync failed.");
      if (payload.state) setState(payload.state);
    } catch (error) {
      setBankError(
        error instanceof Error ? error.message : "Bank sync failed.",
      );
    } finally {
      setBankStatus("idle");
    }
  };

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return [
      ...state.transactions
        .filter((item) =>
          `${item.merchant} ${item.category} ${item.description}`
            .toLowerCase()
            .includes(q),
        )
        .slice(0, 4)
        .map((item) => ({
          title: item.merchant,
          meta: `${item.category} · ${money(item.amount)}`,
          view: "transactions" as NavView,
        })),
      ...state.projects
        .filter((item) => item.name.toLowerCase().includes(q))
        .slice(0, 2)
        .map((item) => ({
          title: item.name,
          meta: `Project · ${item.status}`,
          view: "projects" as NavView,
        })),
      ...state.wishlist
        .filter((item) => item.name.toLowerCase().includes(q))
        .slice(0, 2)
        .map((item) => ({
          title: item.name,
          meta: `Wishlist · ${money(item.price)}`,
          view: "wishlist" as NavView,
        })),
      ...state.goals
        .filter((item) => item.name.toLowerCase().includes(q))
        .slice(0, 2)
        .map((item) => ({
          title: item.name,
          meta: `Goal · ${item.status}`,
          view: "plan" as NavView,
        })),
    ].slice(0, 8);
  }, [query, state]);

  const renderView = () => {
    switch (view) {
      case "home":
        return (
          <>
            <div className="desktop-home-view">
              <HomeView
                state={state}
                tradeoffs={tradeoffs}
                totalSavings={totalSavings}
                cardDebt={cardDebt}
                recommendations={activeRecommendations}
                go={go}
                act={actOnRecommendation}
              />
            </div>
            <div className="mobile-home-view">
              <MobileOverview
                state={state}
                tradeoffs={tradeoffs}
                recommendations={activeRecommendations}
                go={go}
                syncState={bankStatus === "syncing" ? "Syncing" : "Up to date"}
              />
            </div>
          </>
        );
      case "plan":
        return (
          <PlanView
            state={state}
            allocation={allocation}
            update={update}
            openModal={setModal}
          />
        );
      case "transactions":
        return (
          <TransactionsView
            state={state}
            update={update}
            filter={transactionFilter}
            setFilter={setTransactionFilter}
            selected={selectedTransactions}
            setSelected={setSelectedTransactions}
            openModal={setModal}
          />
        );
      case "projects":
        return (
          <ProjectsView state={state} update={update} openModal={setModal} />
        );
      case "wishlist":
        return (
          <WishlistView
            state={state}
            update={update}
            ask={askAboutItem}
            openModal={setModal}
          />
        );
      case "advisor":
        return (
          <AdvisorView
            chat={chat}
            prompt={advisorPrompt}
            setPrompt={setAdvisorPrompt}
            send={sendAdvisor}
          />
        );
      case "reviews":
        return <ReviewsView state={state} update={update} />;
      case "accounts":
        return (
          <AccountsView
            state={state}
            openModal={setModal}
            connectPlaid={connectPlaid}
            syncBank={syncBank}
            syncing={bankStatus === "syncing"}
          />
        );
      case "settings":
        return (
          <SettingsView
            state={state}
            update={update}
            openModal={setModal}
            saveState={saveState}
          />
        );
    }
  };

  if (loading || state.accounts.filter((account) => !account.archived).length === 0) {
    return (
      <BankConnectGate
        name={state.profile.name}
        status={bankStatus}
        error={bankError}
        connect={connectPlaid}
        loading={loading}
      />
    );
  }

  const mobilePrimary: {
    id: NavView | "more";
    label: string;
    icon: typeof Home;
  }[] = [
    { id: "home", label: "Today", icon: Home },
    { id: "plan", label: "Plan", icon: ListChecks },
    { id: "transactions", label: "Activity", icon: WalletCards },
    { id: "projects", label: "Projects", icon: BriefcaseBusiness },
    { id: "more", label: "More", icon: MoreHorizontal },
  ];

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="mobile-brand" onClick={() => go("home")}>
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <strong>Steward</strong>
        </button>
        <div>
          <button
            className="icon-button"
            onClick={() => void syncBank()}
            aria-label="Sync bank data"
            disabled={bankStatus === "syncing"}
          >
            <RefreshCw
              className={bankStatus === "syncing" ? "spin" : ""}
              size={19}
            />
          </button>
          <button
            className="avatar"
            onClick={() => go("settings")}
            aria-label="Open profile"
          >
            {state.profile.name.slice(0, 1)}
          </button>
        </div>
      </header>
      <aside className={cx("sidebar", mobileNav && "open")}>
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Steward</strong>
            <small>Your financial OS</small>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setMobileNav(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={cx("nav-item", view === item.id && "active")}
              onClick={() => go(item.id)}
            >
              <item.icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.id === "transactions" &&
                state.transactions.some((transaction) => transaction.needsReview) && (
                  <b>
                    {
                      state.transactions.filter(
                        (transaction) => transaction.needsReview,
                      ).length
                    }
                  </b>
                )}
            </button>
          ))}
        </nav>
        {state.goals[0] && <div className="sidebar-insight">
          <div className="sidebar-insight-head">
            <span>Emergency fund</span>
            <strong>
              {Math.round(
                (state.goals[0]?.current / state.goals[0]?.target) * 100,
              )}
              %
            </strong>
          </div>
          <Progress
            value={(state.goals[0]?.current / state.goals[0]?.target) * 100}
          />
          <p>{money(state.goals[0]?.target - state.goals[0]?.current)} to go</p>
        </div>}
        <button className="profile-chip" onClick={() => go("settings")}>
          <span>{state.profile.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{state.profile.name}</strong>
            <small>
              {saveState === "saving"
                ? "Saving…"
                : saveState === "offline"
                  ? "Offline mode"
                  : "Private workspace"}
            </small>
          </div>
          <MoreHorizontal size={17} />
        </button>
      </aside>

      {mobileNav && (
        <button
          className="mobile-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}

      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMobileNav(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="global-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search your financial life"
              aria-label="Search Steward"
            />
            <kbd>⌘ K</kbd>
            {searchOpen && query && (
              <div className="search-results">
                <span className="eyebrow">Results</span>
                {results.length ? (
                  results.map((result, index) => (
                    <button
                      key={`${result.title}-${index}`}
                      onClick={() => go(result.view)}
                    >
                      <Search size={15} />
                      <span>
                        <strong>{result.title}</strong>
                        <small>{result.meta}</small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))
                ) : (
                  <p>No matching money, goals, or projects.</p>
                )}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <span className={`save-indicator ${saveState}`}>
              {saveState === "saving"
                ? "Saving"
                : saveState === "offline"
                  ? "Session only"
                  : "Up to date"}
            </span>
            <div className="popover-wrap">
              <button
                className="icon-button notification-button"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label="Notifications"
              >
                <Bell size={19} />
                {state.notifications.some((item) => !item.read) && <i />}
              </button>
              {notificationsOpen && (
                <div className="notification-popover">
                  <div className="popover-title">
                    <strong>What changed</strong>
                    <button
                      onClick={() =>
                        update(
                          "notifications",
                          state.notifications.map((item) => ({
                            ...item,
                            read: true,
                          })),
                        )
                      }
                    >
                      Mark all read
                    </button>
                  </div>
                  {state.notifications.map((item) => (
                    <div
                      className={cx("notification-row", !item.read && "unread")}
                      key={item.id}
                    >
                      <span />
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                        <small>{item.time}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              className="avatar"
              onClick={() => go("settings")}
              aria-label="Open profile"
            >
              {state.profile.name.slice(0, 1)}
            </button>
          </div>
        </header>
        <main className={cx("main-content", loading && "is-loading")}>
          {loading && (
            <div className="loading-line" role="status" aria-label="Loading" />
          )}
          {renderView()}
        </main>
      </div>

      {bankError && (
        <div className="sync-banner" role="status">
          <HelpCircle size={16} />
          <span>{bankError}</span>
          <button onClick={() => setBankError("")} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {mobilePrimary.map((item) => (
          <button
            key={item.id}
            className={cx(
              item.id === "more"
                ? mobileMore
                : view === item.id && !mobileMore
                  ? "active"
                  : "",
            )}
            onClick={() => {
              if (item.id === "more") {
                setMobileMore((open) => !open);
              } else {
                setMobileMore(false);
                go(item.id);
              }
            }}
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {mobileMore && (
        <>
          <button
            className="mobile-more-scrim"
            onClick={() => setMobileMore(false)}
            aria-label="Close more menu"
          />
          <section className="mobile-more-sheet">
            <div>
              <span className="eyebrow">More</span>
              <button
                className="icon-button"
                onClick={() => setMobileMore(false)}
                aria-label="Close more menu"
              >
                <X size={18} />
              </button>
            </div>
            {navItems
              .filter(
                (item) =>
                  !["home", "plan", "transactions", "projects"].includes(
                    item.id,
                  ),
              )
              .map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setMobileMore(false);
                    go(item.id);
                  }}
                >
                  <span><item.icon size={20} /></span>
                  <strong>{item.label}</strong>
                  <ArrowRight size={17} />
                </button>
              ))}
          </section>
        </>
      )}

      {modal && (
        <EntityModal
          modal={modal}
          state={state}
          setState={setState}
          close={() => {
            setModal(null);
            setOnboardingStep(0);
          }}
          onboardingStep={onboardingStep}
          setOnboardingStep={setOnboardingStep}
        />
      )}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function MobileOverview({
  state,
  tradeoffs,
  recommendations,
  go,
  syncState,
}: {
  state: StewardState;
  tradeoffs: ReturnType<typeof calculateTradeoffs>;
  recommendations: Recommendation[];
  go: (view: NavView) => void;
  syncState: string;
}) {
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());
  const nextBill = state.bills
    .filter((bill) => !bill.paid)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const nextAction = recommendations[0];
  const riskTone =
    tradeoffs.risk === "Low"
      ? "good"
      : tradeoffs.risk === "Moderate"
        ? "watch"
        : "alert";

  return (
    <section className="mobile-overview" aria-label="Today overview">
      <header className="mobile-overview-heading">
        <div>
          <span>Today</span>
          <small>{today}</small>
        </div>
        <p><i className={syncState === "Syncing" ? "is-syncing" : ""} /> {syncState}</p>
      </header>

      <button className="mobile-safe-card" onClick={() => go("plan")}>
        <span className="mobile-card-label">SAFE TO SPEND</span>
        <strong>{money(tradeoffs.safeToSpend)}</strong>
        <p>
          after {money(tradeoffs.billsBeforePayday)} for bills and your
          {" "}{money(state.profile.minimumBuffer)} buffer
        </p>
        <span className={`mobile-risk ${riskTone}`}>
          <ShieldCheck size={13} /> {tradeoffs.risk} risk
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>

      <div className="mobile-overview-stats">
        <button onClick={() => go("accounts")}>
          <span className="mobile-stat-icon cash"><WalletCards size={17} /></span>
          <small>Available now</small>
          <strong>{money(tradeoffs.liquidCash)}</strong>
        </button>
        <button onClick={() => go("plan")}>
          <span className="mobile-stat-icon calendar"><CalendarClock size={17} /></span>
          <small>{nextBill ? "Next bill" : "Bills"}</small>
          <strong>
            {nextBill ? money(nextBill.amount) : "None due"}
          </strong>
          {nextBill && <em>{nextBill.name}</em>}
        </button>
      </div>

      <button
        className="mobile-next-action"
        onClick={() => go(nextAction ? "advisor" : "transactions")}
      >
        <span className={`mobile-action-icon ${nextAction?.type ?? "clear"}`}>
          {nextAction ? <Sparkles size={19} /> : <CheckCircle2 size={19} />}
        </span>
        <span>
          <small>UP NEXT</small>
          <strong>
            {nextAction?.title ?? "Nothing needs your attention"}
          </strong>
          <em>
            {nextAction?.description ??
              "Your connected accounts are up to date."}
          </em>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>

      <nav className="mobile-overview-shortcuts" aria-label="Today shortcuts">
        <button onClick={() => go("transactions")}>
          <WalletCards size={19} />
          <span>Activity</span>
        </button>
        <button onClick={() => go("plan")}>
          <ListChecks size={19} />
          <span>Plan</span>
        </button>
        <button onClick={() => go("advisor")}>
          <Sparkles size={19} />
          <span>Ask</span>
        </button>
      </nav>
    </section>
  );
}

function HomeView({
  state,
  tradeoffs,
  totalSavings,
  cardDebt,
  recommendations,
  go,
  act,
}: {
  state: StewardState;
  tradeoffs: ReturnType<typeof calculateTradeoffs>;
  totalSavings: number;
  cardDebt: number;
  recommendations: Recommendation[];
  go: (view: NavView) => void;
  act: (
    recommendation: Recommendation,
    action: "completed" | "dismissed" | "snoozed",
  ) => void;
}) {
  const upcoming = state.bills
    .filter((bill) => !bill.paid)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4);
  const firstName = state.profile.name.split(" ")[0];
  const primaryRecommendation = recommendations[0];
  const currentHour = new Date().getHours();
  const greeting =
    currentHour < 12
      ? "Good morning"
      : currentHour < 18
        ? "Good afternoon"
        : "Good evening";
  return (
    <div className="page">
      <SectionHeader
        eyebrow="Your live financial briefing"
        title={`${greeting}, ${firstName}.`}
        description="Built from the accounts and activity you connected."
        action={
          <button className="secondary-button" onClick={() => go("advisor")}>
            <Sparkles size={16} /> Ask Steward
          </button>
        }
      />

      <section className="decision-hero">
        <div className="decision-copy">
          <Pill tone={tradeoffs.risk === "Low" ? "green" : "amber"}>
            <ShieldCheck size={13} /> {tradeoffs.risk} risk
          </Pill>
          <span className="eyebrow">Your next best move</span>
          <h2>{primaryRecommendation?.title ?? "Your accounts are up to date."}</h2>
          <p>
            {primaryRecommendation?.description ??
              "Steward will surface a clear next action as connected activity changes."}
          </p>
          <div className="hero-actions">
            <button
              className="primary-button"
              onClick={() => {
                if (primaryRecommendation) {
                  act(primaryRecommendation, "completed");
                } else {
                  go("transactions");
                }
              }}
            >
              {primaryRecommendation?.action ?? "Review activity"}{" "}
              <ArrowRight size={16} />
            </button>
            <button className="text-button" onClick={() => go("advisor")}>
              Why this amount? <HelpCircle size={15} />
            </button>
          </div>
        </div>
        <div className="safe-spend-card">
          <div>
            <span>Safe to spend today</span>
            <strong>{money(tradeoffs.safeToSpend)}</strong>
            <small>after bills, savings, debt, and buffer</small>
          </div>
          <div className="safe-spend-breakdown">
            <span>
              <i className="cash" /> Available cash
              <b>{money(tradeoffs.liquidCash)}</b>
            </span>
            <span>
              <i className="reserved" /> Reserved
              <b>
                {money(
                  tradeoffs.billsBeforePayday +
                    tradeoffs.requiredDebt +
                    tradeoffs.savingsCommitment,
                )}
              </b>
            </span>
            <span>
              <i className="buffer" /> Protected buffer
              <b>{money(state.profile.minimumBuffer)}</b>
            </span>
          </div>
          <button onClick={() => go("plan")}>
            See the full calculation <ArrowRight size={15} />
          </button>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <div className="metric-icon green">
            <WalletCards size={18} />
          </div>
          <span>Available cash</span>
          <strong>{money(tradeoffs.liquidCash)}</strong>
          <small>Across connected checking accounts</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon blue">
            <TrendingUp size={18} />
          </div>
          <span>Total savings</span>
          <strong>{money(totalSavings)}</strong>
          <small>Across connected savings accounts</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon amber">
            <CreditCard size={18} />
          </div>
          <span>Credit-card debt</span>
          <strong>{money(cardDebt)}</strong>
          <small>Current connected card balances</small>
        </article>
        <article className="metric-card">
          <div className="metric-icon violet">
            <CalendarClock size={18} />
          </div>
          <span>Next payday</span>
          <strong>
            {state.profile.nextPayday
              ? `${daysUntil(state.profile.nextPayday)} days`
              : "Not detected"}
          </strong>
          <small>
            {state.profile.takeHomePay
              ? `${money(state.profile.takeHomePay)} expected`
              : "Add or detect recurring income"}
          </small>
        </article>
      </section>

      <section className="content-grid">
        <div className="stack-card recommendations-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Worth your attention</span>
              <h2>Today’s decisions</h2>
            </div>
            <button onClick={() => go("advisor")}>Ask a question</button>
          </div>
          {recommendations.length ? (
            recommendations.map((recommendation, index) => (
              <article className="recommendation-row" key={recommendation.id}>
                <div className={`rec-number ${recommendation.type}`}>
                  {index + 1}
                </div>
                <div className="rec-copy">
                  <div>
                    <h3>{recommendation.title}</h3>
                    <Pill
                      tone={
                        recommendation.priority === "now" ? "green" : "neutral"
                      }
                    >
                      {recommendation.priority}
                    </Pill>
                  </div>
                  <p>{recommendation.description}</p>
                  <button onClick={() => go("advisor")}>
                    Why <ChevronDown size={13} />
                  </button>
                </div>
                <div className="rec-actions">
                  <button
                    className="small-primary"
                    onClick={() => act(recommendation, "completed")}
                  >
                    {recommendation.action}
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => act(recommendation, "snoozed")}
                    aria-label="Snooze recommendation"
                  >
                    <MoreHorizontal size={17} />
                  </button>
                </div>
              </article>
            ))
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="You’re all caught up"
              body="Steward will surface the next useful decision when your situation changes."
            />
          )}
        </div>

        <div className="stack-card bills-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Before payday</span>
              <h2>Upcoming obligations</h2>
            </div>
            <button onClick={() => go("plan")}>View all</button>
          </div>
          {upcoming.length ? upcoming.map((bill) => (
            <div className="bill-row" key={bill.id}>
              <div className="date-tile">
                <strong>
                  {new Date(`${bill.dueDate}T12:00:00`).getDate()}
                </strong>
                <span>
                  {new Date(`${bill.dueDate}T12:00:00`).toLocaleDateString(
                    "en-US",
                    { month: "short" },
                  )}
                </span>
              </div>
              <div>
                <strong>{bill.name}</strong>
                <small>{bill.autopay ? "Autopay on" : "Manual payment"}</small>
              </div>
              <b>{money(bill.amount)}</b>
            </div>
          )) : (
            <EmptyState
              icon={CalendarClock}
              title="No recurring bills detected yet"
              body="Plaid may still be building transaction history, or recurring insights may not be enabled for this connection."
            />
          )}
          {upcoming.length > 0 && <div className="reserved-note">
            <ShieldCheck size={17} />
            <p>
              <strong>{money(tradeoffs.billsBeforePayday)} is reserved.</strong>
              These bills are already excluded from safe-to-spend.
            </p>
          </div>}
        </div>
      </section>

      <section className="bottom-grid">
        <div className="stack-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Life in progress</span>
              <h2>Projects</h2>
            </div>
            <button onClick={() => go("projects")}>View all</button>
          </div>
          {state.projects.slice(0, 3).map((project) => (
            <button
              className="project-mini"
              key={project.id}
              onClick={() => go("projects")}
            >
              <span className={`project-symbol ${project.category.toLowerCase()}`}>
                {project.category === "Home" ? (
                  <Home size={18} />
                ) : project.category === "Hobby" ? (
                  <Flag size={18} />
                ) : (
                  <BriefcaseBusiness size={18} />
                )}
              </span>
              <div>
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.progress}%</small>
                </span>
                <Progress value={project.progress} />
                <p>{project.nextAction}</p>
              </div>
            </button>
          ))}
          {!state.projects.length && (
            <EmptyState
              icon={BriefcaseBusiness}
              title="No projects yet"
              body="Add a real goal or purchase you want Steward to plan around."
            />
          )}
        </div>
        <div className="stack-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Available opportunity</span>
              <h2>What you can buy</h2>
            </div>
            <button onClick={() => go("wishlist")}>Wishlist</button>
          </div>
          {state.wishlist
            .filter((item) => item.status === "Recommended now")
            .slice(0, 1)
            .map((item) => (
              <div className="purchase-feature" key={item.id}>
                <span className="purchase-icon">
                  <ShoppingBag size={25} />
                </span>
                <div>
                  <Pill tone="green">Safe now</Pill>
                  <h3>{item.name}</h3>
                  <strong>{money(item.price)}</strong>
                  <p>{item.reason}</p>
                  <button
                    className="secondary-button"
                    onClick={() => go("wishlist")}
                  >
                    View recommendation <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            ))}
          {!state.wishlist.some(
            (item) => item.status === "Recommended now",
          ) && (
            <EmptyState
              icon={ShoppingBag}
              title="Nothing marked safe to buy"
              body="Add an item to compare it with your connected cash and obligations."
            />
          )}
        </div>
        <div className="stack-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Primary goal</span>
              <h2>{state.goals[0]?.name ?? "Your first goal"}</h2>
            </div>
            <button onClick={() => go("plan")}>Details</button>
          </div>
          {state.goals[0] ? <div className="goal-feature">
            <div className="goal-ring">
              <strong>
                {Math.round(
                  (state.goals[0].current / state.goals[0].target) * 100,
                )}
                %
              </strong>
            </div>
            <div>
              <strong>
                {money(state.goals[0].current)}{" "}
                <small>of {money(state.goals[0].target)}</small>
              </strong>
              <p>
                Steward will track this against your connected balances and plan.
              </p>
              <span>
                Next contribution{" "}
                <b>{money(state.goals[0].recommendedContribution)}</b>
              </span>
            </div>
          </div> : (
            <EmptyState
              icon={Flag}
              title="No goal set"
              body="Create a goal when you are ready to give the plan a destination."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function PlanView({
  state,
  allocation,
  update,
  openModal,
}: {
  state: StewardState;
  allocation: ReturnType<typeof paycheckAllocation>;
  update: <K extends keyof StewardState>(key: K, value: StewardState[K]) => void;
  openModal: (modal: ModalName) => void;
}) {
  const [tab, setTab] = useState<"paycheck" | "budget" | "goals" | "bills">(
    "paycheck",
  );
  const [customCategory, setCustomCategory] = useState("Hobbies");
  const [customAmount, setCustomAmount] = useState(0);
  const setPlan = (field: keyof StewardState["paycheckPlan"], value: number) =>
    update("paycheckPlan", { ...state.paycheckPlan, [field]: value });
  const setBudget = (id: string, planned: number) =>
    update(
      "budgets",
      state.budgets.map((budget) =>
        budget.id === id
          ? { ...budget, planned: Math.max(0, planned), source: "manual" }
          : budget,
      ),
    );
  const addBudget = () => {
    const category = customCategory.trim();
    if (!category) return;
    const existing = state.budgets.find((budget) => budget.category === category);
    if (existing) {
      setBudget(existing.id, customAmount);
      return;
    }
    const budget: Budget = {
      id: `manual-budget-${category.toLowerCase().replaceAll(" ", "-")}`,
      category,
      planned: Math.max(0, customAmount),
      actual: 0,
      cadence: "Monthly",
      essential: [
        "Housing",
        "Utilities",
        "Groceries",
        "Transportation",
        "Healthcare",
        "Debt payments",
      ].includes(category),
      source: "manual",
    };
    update("budgets", [...state.budgets, budget]);
  };
  return (
    <div className="page">
      <SectionHeader
        eyebrow="Make the next dollar useful"
        title="Your plan"
        description="Protect obligations first, then choose what the remaining money should accomplish."
        action={
          <button className="secondary-button">
            <RefreshCw size={16} /> Recalculate
          </button>
        }
      />
      <div className="tab-bar" role="tablist">
        {(["paycheck", "budget", "goals", "bills"] as const).map((item) => (
          <button
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
            key={item}
          >
            {item === "paycheck"
              ? "Next paycheck"
              : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === "paycheck" && (
        <>
          <section className="plan-hero">
            <div>
              <span className="eyebrow">Expected {state.paycheckPlan.date}</span>
              <h2>{money(allocation.income)}</h2>
              <p>
                {money(allocation.assigned)} assigned ·{" "}
                <strong
                  className={allocation.remaining < 0 ? "negative" : "positive"}
                >
                  {money(allocation.remaining)} left to direct
                </strong>
              </p>
              <Progress
                value={allocation.percentAssigned}
                tone={allocation.remaining < 0 ? "amber" : "green"}
              />
            </div>
            <div className="plan-summary">
              <span>
                <i className="dot essential" /> Essentials
                <b>
                  {money(
                    allocation.upcomingBills +
                      state.paycheckPlan.groceries +
                      state.paycheckPlan.transportation,
                  )}
                </b>
              </span>
              <span>
                <i className="dot progress-dot" /> Future you
                <b>
                  {money(
                    state.paycheckPlan.savings + state.paycheckPlan.debt,
                  )}
                </b>
              </span>
              <span>
                <i className="dot flexible" /> Flexible
                <b>
                  {money(
                    state.paycheckPlan.dining + state.paycheckPlan.projects,
                  )}
                </b>
              </span>
            </div>
          </section>
          <section className="allocation-layout">
            <div className="stack-card">
              <div className="card-heading">
                <div>
                  <span className="eyebrow">Allocation</span>
                  <h2>Give every part a job</h2>
                </div>
                <Pill tone={allocation.remaining < 0 ? "amber" : "green"}>
                  {allocation.remaining < 0 ? "Needs attention" : "On track"}
                </Pill>
              </div>
              <div className="allocation-list">
                <div className="allocation-row fixed">
                  <span className="allocation-icon housing">
                    <CalendarClock size={18} />
                  </span>
                  <div>
                    <strong>Bills before next payday</strong>
                    <small>Calculated from upcoming obligations</small>
                  </div>
                  <b>{money(allocation.upcomingBills)}</b>
                </div>
                {[
                  ["savings", "Savings contribution", "Emergency fund"],
                  ["debt", "Additional debt payment", "Travel card"],
                  ["groceries", "Groceries", "Two weeks"],
                  ["transportation", "Transportation", "Gas and transit"],
                  ["dining", "Dining", "Flexible"],
                  ["buffer", "Cycle buffer", "Unexpected needs"],
                  ["projects", "Project fund", "Apartment first"],
                ].map(([field, label, hint]) => (
                  <div className="allocation-row" key={field}>
                    <span className={`allocation-icon ${field}`}>
                      {field === "savings" ? (
                        <TrendingUp size={18} />
                      ) : field === "debt" ? (
                        <CreditCard size={18} />
                      ) : field === "projects" ? (
                        <BriefcaseBusiness size={18} />
                      ) : (
                        <CircleDollarSign size={18} />
                      )}
                    </span>
                    <div>
                      <strong>{label}</strong>
                      <small>{hint}</small>
                    </div>
                    <label className="money-input">
                      <span>$</span>
                      <input
                        type="number"
                        min={0}
                        value={
                          state.paycheckPlan[
                            field as keyof typeof state.paycheckPlan
                          ]
                        }
                        onChange={(event) =>
                          setPlan(
                            field as keyof StewardState["paycheckPlan"],
                            Number(event.target.value),
                          )
                        }
                        aria-label={label}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
            <aside className="stack-card plan-outcome">
              <span className="eyebrow">Expected outcome</span>
              <h2>Before the following payday</h2>
              <div className="outcome-amount">
                <span>Checking balance</span>
                <strong>
                  {money(
                    state.accounts.find(
                      (account) => account.type === "Checking",
                    )?.available ?? 0,
                  )}
                </strong>
              </div>
              <div className="outcome-row">
                <span>Plan impact</span>
                <b>
                  {money(
                    allocation.income -
                      allocation.assigned +
                      state.paycheckPlan.buffer,
                  )}
                </b>
              </div>
              <div className="outcome-row">
                <span>Protected minimum</span>
                <b>{money(state.profile.minimumBuffer)}</b>
              </div>
              <div className="advisor-note">
                <Sparkles size={18} />
                <p>
                  <strong>Steward’s read</strong>
                  {allocation.remaining < 0
                    ? "The current allocations exceed the expected paycheck. Reduce a flexible category before saving."
                    : allocation.income > 0
                      ? `${money(allocation.remaining)} remains unassigned based on the connected income and obligations above.`
                      : "A paycheck plan will appear when recurring income is detected or entered."}
                </p>
              </div>
              <button className="primary-button">
                Save paycheck cycle <Check size={16} />
              </button>
            </aside>
          </section>
        </>
      )}

      {tab === "budget" && (
        <section className="stack-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Suggested from your real picture</span>
              <h2>Budget health</h2>
              <p>
                Suggestions reserve recurring bills, use your pay cadence and
                recent spending, and leave room for hobbies you have added.
                Any amount you change becomes your budget.
              </p>
            </div>
            <div className="button-row">
              <Pill tone={state.budgets.some((item) => item.actual > item.planned) ? "amber" : "green"}>
                {state.budgets.length
                  ? state.budgets.some((item) => item.actual > item.planned)
                    ? "Review needed"
                    : "Within recent averages"
                  : "Waiting for activity"}
              </Pill>
              <button
                className="secondary-button"
                onClick={() => update("budgets", suggestBudgets(state))}
              >
                <Sparkles size={15} /> Refresh suggestion
              </button>
            </div>
          </div>
          <div className="transaction-tools budget-tools">
            <select
              value={customCategory}
              onChange={(event) => setCustomCategory(event.target.value)}
              aria-label="Budget category"
            >
              {categories
                .filter((category) => !["Transfers", "Uncategorized"].includes(category))
                .map((category) => (
                  <option key={category}>{category}</option>
                ))}
            </select>
            <label className="money-input">
              <span>$</span>
              <input
                type="number"
                min={0}
                value={customAmount}
                onChange={(event) => setCustomAmount(Number(event.target.value))}
                aria-label="Monthly budget amount"
              />
            </label>
            <button className="secondary-button" onClick={addBudget}>
              <Plus size={15} /> Add custom budget
            </button>
          </div>
          <div className="budget-grid">
            {state.budgets.map((budget) => {
              const percent = budget.planned ? (budget.actual / budget.planned) * 100 : 0;
              return (
                <article className="budget-card" key={budget.id}>
                  <div>
                    <span>{budget.category}</span>
                    <Pill tone={budget.source === "manual" ? "green" : percent > 90 ? "amber" : "neutral"}>
                      {budget.source === "manual"
                        ? "Your budget"
                        : budget.essential
                          ? "Essential"
                          : "Suggested"}
                    </Pill>
                  </div>
                  <strong>{money(budget.planned - budget.actual)}</strong>
                  <label className="money-input compact-input">
                    <span>$</span>
                    <input
                      type="number"
                      min={0}
                      value={budget.planned}
                      onChange={(event) => setBudget(budget.id, Number(event.target.value))}
                      aria-label={`Monthly budget for ${budget.category}`}
                    />
                  </label>
                  <small>monthly budget · {money(budget.actual)} spent</small>
                  <Progress
                    value={percent}
                    tone={percent > 90 ? "amber" : "green"}
                  />
                  <p>{Math.round(percent)}% used this month</p>
                </article>
              );
            })}
          </div>
          {!state.budgets.length && (
            <EmptyState
              icon={Sparkles}
              title="Your suggestion will appear here"
              body="Connect a bank or add a custom category to start building an editable budget."
            />
          )}
        </section>
      )}

      {tab === "goals" && (
        <section>
          <div className="inline-section-head">
            <div>
              <span className="eyebrow">Your priorities</span>
              <h2>Goals</h2>
            </div>
            <button className="primary-button" onClick={() => openModal("goal")}>
              <Plus size={16} /> New goal
            </button>
          </div>
          <div className="goal-grid">
            {state.goals.map((goal) => (
              <article className="stack-card goal-card" key={goal.id}>
                <div className="goal-card-head">
                  <span className={`goal-icon ${goal.type.toLowerCase()}`}>
                    {goal.type === "Debt payoff" ? (
                      <CreditCard size={20} />
                    ) : goal.type === "Travel" ? (
                      <Flag size={20} />
                    ) : (
                      <ShieldCheck size={20} />
                    )}
                  </span>
                  <Pill tone={goal.priority === "High" ? "green" : "neutral"}>
                    {goal.priority} priority
                  </Pill>
                </div>
                <h3>{goal.name}</h3>
                <strong>
                  {money(goal.current)} <small>of {money(goal.target)}</small>
                </strong>
                <Progress value={(goal.current / goal.target) * 100} />
                <div className="goal-meta">
                  <span>
                    Recommended <b>{money(goal.recommendedContribution)}</b>
                  </span>
                  <span>
                    Target{" "}
                    <b>
                      {new Date(`${goal.targetDate}T12:00:00`).toLocaleDateString(
                        "en-US",
                        { month: "short", year: "numeric" },
                      )}
                    </b>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "bills" && (
        <section className="stack-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">Known obligations</span>
              <h2>Bills & subscriptions</h2>
            </div>
            <button className="primary-button" onClick={() => openModal("bill")}>
              <Plus size={16} /> Add bill
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Next due</th>
                  <th>Frequency</th>
                  <th>Autopay</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {state.bills.map((bill) => (
                  <tr key={bill.id}>
                    <td>
                      <strong>{bill.name}</strong>
                      <small>{bill.essential ? "Essential" : "Flexible"}</small>
                    </td>
                    <td>{bill.dueDate}</td>
                    <td>{bill.frequency}</td>
                    <td>
                      <Pill tone={bill.autopay ? "green" : "amber"}>
                        {bill.autopay ? "On" : "Manual"}
                      </Pill>
                    </td>
                    <td>
                      <strong>{money(bill.amount)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function TransactionsView({
  state,
  update,
  filter,
  setFilter,
  selected,
  setSelected,
  openModal,
}: {
  state: StewardState;
  update: <K extends keyof StewardState>(key: K, value: StewardState[K]) => void;
  filter: string;
  setFilter: (value: string) => void;
  selected: string[];
  setSelected: (value: string[]) => void;
  openModal: (modal: ModalName) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = state.transactions
    .filter((transaction) => {
      const matchesSearch = `${transaction.merchant} ${transaction.description}`
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesFilter =
        filter === "All" ||
        (filter === "Needs review" && transaction.needsReview) ||
        transaction.category === filter;
      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const changeCategory = (id: string, category: string) => {
    update(
      "transactions",
      state.transactions.map((transaction) =>
        transaction.id === id
          ? {
              ...transaction,
              category,
              categorySource: "manual",
              needsReview: false,
              confidence: 1,
              note:
                transaction.note ??
                "Category confirmed by you; reusable learning signal stored.",
            }
          : transaction,
      ),
    );
  };

  const bulkCategorize = (category: string) => {
    update(
      "transactions",
      state.transactions.map((transaction) =>
        selected.includes(transaction.id)
          ? {
              ...transaction,
              category,
              categorySource: "manual",
              needsReview: false,
              confidence: 1,
            }
          : transaction,
      ),
    );
    setSelected([]);
  };

  return (
    <div className="page">
      <SectionHeader
        eyebrow="Clean data, better decisions"
        title="Transactions"
        description="Review what needs context. Steward handles the obvious matches automatically."
        action={
          <button
            className="primary-button"
            onClick={() => openModal("transaction")}
          >
            <Plus size={16} /> Add transaction
          </button>
        }
      />
      <section className="stack-card">
        <div className="transaction-tools">
          <label className="local-search">
            <Search size={16} />
            <input
              placeholder="Merchant, description, or note"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="Filter transactions"
          >
            <option>All</option>
            <option>Needs review</option>
            {categories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
          <button className="secondary-button">
            <Upload size={15} /> Import CSV
          </button>
        </div>
        {selected.length > 0 && (
          <div className="bulk-bar">
            <strong>{selected.length} selected</strong>
            <select
              defaultValue=""
              onChange={(event) => bulkCategorize(event.target.value)}
              aria-label="Bulk categorize"
            >
              <option value="" disabled>
                Set category
              </option>
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
            <button onClick={() => setSelected([])}>Clear</button>
          </div>
        )}
        <div className="table-wrap transaction-table">
          <table>
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all visible transactions"
                    checked={
                      visible.length > 0 &&
                      visible.every((item) => selected.includes(item.id))
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? visible.map((item) => item.id)
                          : [],
                      )
                    }
                  />
                </th>
                <th>Merchant</th>
                <th>Category</th>
                <th>Account</th>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((transaction) => (
                <tr
                  className={transaction.needsReview ? "needs-review" : ""}
                  key={transaction.id}
                >
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      aria-label={`Select ${transaction.merchant}`}
                      checked={selected.includes(transaction.id)}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, transaction.id]
                            : selected.filter((id) => id !== transaction.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <span className="merchant-cell">
                      <i>{transaction.merchant.slice(0, 1)}</i>
                      <span>
                        <strong>{transaction.merchant}</strong>
                        <small>
                          {transaction.description}
                          {transaction.pending && " · Pending"}
                        </small>
                      </span>
                    </span>
                  </td>
                  <td>
                    <select
                      className={transaction.needsReview ? "review-select" : ""}
                      value={transaction.category}
                      onChange={(event) =>
                        changeCategory(transaction.id, event.target.value)
                      }
                      aria-label={`Category for ${transaction.merchant}`}
                    >
                      {categories.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                    {transaction.needsReview && (
                      <small className="review-label">Needs your context</small>
                    )}
                  </td>
                  <td>
                    {state.accounts.find(
                      (account) => account.id === transaction.accountId,
                    )?.name ?? "Unknown"}
                  </td>
                  <td>{transaction.date}</td>
                  <td
                    className={
                      transaction.type === "income"
                        ? "amount income"
                        : "amount"
                    }
                  >
                    {transaction.type === "income" ? "+" : "−"}
                    {money(transaction.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <EmptyState
            icon={Search}
            title="No matching transactions"
            body="Try another merchant, category, or review status."
          />
        )}
      </section>
    </div>
  );
}

function ProjectsView({
  state,
  update,
  openModal,
}: {
  state: StewardState;
  update: <K extends keyof StewardState>(key: K, value: StewardState[K]) => void;
  openModal: (modal: ModalName) => void;
}) {
  const toggleTask = (projectId: string, taskId: string) => {
    update(
      "projects",
      state.projects.map((project) => {
        if (project.id !== projectId) return project;
        const tasks = project.tasks.map((task) =>
          task.id === taskId ? { ...task, complete: !task.complete } : task,
        );
        return {
          ...project,
          tasks,
          progress: Math.round(
            (tasks.filter((task) => task.complete).length / tasks.length) * 100,
          ),
        };
      }),
    );
  };
  return (
    <div className="page">
      <SectionHeader
        eyebrow="Money in service of your life"
        title="Projects"
        description="See what each improvement costs, what comes next, and whether now is the right time."
        action={
          <button className="primary-button" onClick={() => openModal("project")}>
            <Plus size={16} /> New project
          </button>
        }
      />
      {state.projects.length ? (
        <div className="projects-grid">
          {state.projects.map((project) => {
            const remaining = project.estimatedCost - project.actualCost;
            return (
              <article className="stack-card project-card" key={project.id}>
                <div className="project-card-top">
                  <span
                    className={`project-symbol ${project.category.toLowerCase()}`}
                  >
                    {project.category === "Home" ? (
                      <Home size={21} />
                    ) : project.category === "Hobby" ? (
                      <Flag size={21} />
                    ) : (
                      <BriefcaseBusiness size={21} />
                    )}
                  </span>
                  <div>
                    <Pill
                      tone={project.status === "Active" ? "green" : "neutral"}
                    >
                      {project.status}
                    </Pill>
                    <button className="icon-button" aria-label="Project options">
                      <MoreHorizontal size={17} />
                    </button>
                  </div>
                </div>
                <h2>{project.name}</h2>
                <p>{project.description}</p>
                <div className="project-progress">
                  <span>
                    <b>{project.progress}% complete</b>
                    <small>{money(remaining)} remaining</small>
                  </span>
                  <Progress value={project.progress} />
                </div>
                <div className="project-decision">
                  <Lightbulb size={17} />
                  <p>
                    <strong>Next best action</strong>
                    {project.nextAction}
                  </p>
                </div>
                <div className="task-list">
                  {project.tasks.map((task) => (
                    <button
                      className={task.complete ? "complete" : ""}
                      key={task.id}
                      onClick={() => toggleTask(project.id, task.id)}
                    >
                      <span>{task.complete && <Check size={13} />}</span>
                      {task.title}
                    </button>
                  ))}
                </div>
                <div className="project-footer">
                  <span>
                    Spent <b>{money(project.actualCost)}</b>
                  </span>
                  <span>
                    Target <b>{project.targetDate}</b>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={BriefcaseBusiness}
          title="No projects yet"
          body="Create a meaningful area of your life that Steward can help fund."
          action={
            <button
              className="primary-button"
              onClick={() => openModal("project")}
            >
              Create a project
            </button>
          }
        />
      )}
    </div>
  );
}

function WishlistView({
  state,
  update,
  ask,
  openModal,
}: {
  state: StewardState;
  update: <K extends keyof StewardState>(key: K, value: StewardState[K]) => void;
  ask: (item: WishlistItem) => void;
  openModal: (modal: ModalName) => void;
}) {
  const [filter, setFilter] = useState("All");
  const visible =
    filter === "All"
      ? state.wishlist
      : state.wishlist.filter((item) => item.status === filter);
  const setStatus = (
    item: WishlistItem,
    status: WishlistItem["status"],
  ) =>
    update(
      "wishlist",
      state.wishlist.map((wish) =>
        wish.id === item.id ? { ...wish, status } : wish,
      ),
    );
  return (
    <div className="page">
      <SectionHeader
        eyebrow="Buy intentionally"
        title="Wishlist"
        description="Steward weighs timing, priorities, and tradeoffs—not just whether the cash exists."
        action={
          <button
            className="primary-button"
            onClick={() => openModal("wishlist")}
          >
            <Plus size={16} /> Add item
          </button>
        }
      />
      <div className="filter-row">
        {["All", "Recommended now", "Planned", "Wait", "Considering"].map(
          (item) => (
            <button
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
              key={item}
            >
              {item}
            </button>
          ),
        )}
      </div>
      {visible.length ? (
        <div className="wishlist-grid">
          {visible.map((item) => {
            const project = state.projects.find(
              (projectItem) => projectItem.id === item.projectId,
            );
            return (
              <article
                className={cx(
                  "stack-card wishlist-card",
                  item.status === "Recommended now" && "recommended",
                )}
                key={item.id}
              >
                <div className="wishlist-card-head">
                  <span className={`wish-icon ${item.category.toLowerCase()}`}>
                    {item.category === "Education" ? (
                      <BookOpen size={22} />
                    ) : item.category === "Home" ? (
                      <Home size={22} />
                    ) : (
                      <ShoppingBag size={22} />
                    )}
                  </span>
                  <Pill
                    tone={
                      item.status === "Recommended now"
                        ? "green"
                        : item.status === "Wait"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {item.status}
                  </Pill>
                </div>
                <span className="eyebrow">{project?.name ?? item.category}</span>
                <h2>{item.name}</h2>
                <strong className="wish-price">{money(item.price)}</strong>
                <div className="wish-reason">
                  {item.status === "Recommended now" ? (
                    <CheckCircle2 size={18} />
                  ) : item.status === "Wait" ? (
                    <CalendarClock size={18} />
                  ) : (
                    <Lightbulb size={18} />
                  )}
                  <p>{item.reason}</p>
                </div>
                <div className="wish-timing">
                  <span>Earliest safe date</span>
                  <b>
                    {daysUntil(item.safeDate) <= 0
                      ? "Today"
                      : new Date(`${item.safeDate}T12:00:00`).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" },
                        )}
                  </b>
                </div>
                <div className="wishlist-actions">
                  <button
                    className="secondary-button"
                    onClick={() => ask(item)}
                  >
                    <Sparkles size={15} /> Can I afford this?
                  </button>
                  <select
                    value={item.status}
                    onChange={(event) =>
                      setStatus(
                        item,
                        event.target.value as WishlistItem["status"],
                      )
                    }
                    aria-label={`Status for ${item.name}`}
                  >
                    {[
                      "Considering",
                      "Planned",
                      "Recommended now",
                      "Wait",
                      "Purchased",
                      "Rejected",
                    ].map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={ShoppingBag}
          title="Nothing in this view"
          body="Change the filter or add something worth planning for."
        />
      )}
    </div>
  );
}

function AdvisorView({
  chat,
  prompt,
  setPrompt,
  send,
}: {
  chat: ChatMessage[];
  prompt: string;
  setPrompt: (value: string) => void;
  send: (prompt?: string) => void;
}) {
  const suggestions = [
    "What should I do with my next paycheck?",
    "Can I afford the premium golf net?",
    "What bills are coming up?",
    "Why is my checking balance lower?",
  ];
  return (
    <div className="page advisor-page">
      <SectionHeader
        eyebrow="Ask about a decision"
        title="Steward Advisor"
        description="Specific answers grounded in your actual balances, obligations, priorities, and preferences."
        action={
          <Pill tone="green">
            <ShieldCheck size={13} /> Private context
          </Pill>
        }
      />
      <section className="advisor-layout">
        <div className="advisor-chat">
          <div className="chat-thread" aria-live="polite">
            {chat.map((message) => (
              <div
                className={`chat-message ${message.role}`}
                key={message.id}
              >
                {message.role === "advisor" && (
                  <span className="advisor-avatar">
                    <Sparkles size={16} />
                  </span>
                )}
                <div>
                  <small>
                    {message.role === "advisor" ? "Steward" : "You"}
                  </small>
                  <p>{message.text}</p>
                  {message.detail && (
                    <div className="advisor-detail">
                      <Eye size={14} />
                      <span>{message.detail}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <form
            className="advisor-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask: Can I afford this? What should I do next?"
              rows={2}
              aria-label="Ask Steward"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div>
              <span>Deterministic math · explainable advice</span>
              <button className="primary-button" type="submit">
                Send <ArrowUpRight size={16} />
              </button>
            </div>
          </form>
        </div>
        <aside className="advisor-sidebar">
          <div className="stack-card">
            <span className="eyebrow">Try asking</span>
            <div className="prompt-list">
              {suggestions.map((suggestion) => (
                <button key={suggestion} onClick={() => send(suggestion)}>
                  <MessageCircle size={15} />
                  {suggestion}
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </div>
          <div className="stack-card context-card">
            <span className="eyebrow">What I’m using</span>
            <h3>Your current context</h3>
            <ul>
              <li>
                <Check size={14} /> Account balances
              </li>
              <li>
                <Check size={14} /> Upcoming bills
              </li>
              <li>
                <Check size={14} /> Goals and projects
              </li>
              <li>
                <Check size={14} /> Your protected buffer
              </li>
              <li>
                <Check size={14} /> Recent spending
              </li>
            </ul>
            <p>
              Steward never invents missing financial data. Estimates and
              assumptions are labeled.
            </p>
          </div>
        </aside>
      </section>
    </div>
  );
}

function ReviewsView({
  state,
  update,
}: {
  state: StewardState;
  update: <K extends keyof StewardState>(key: K, value: StewardState[K]) => void;
}) {
  const regenerate = (id: string) =>
    update(
      "reviews",
      state.reviews.map((review) =>
        review.id === id
          ? {
              ...review,
              focus:
                "Protect the buffer, make the planned card payment, then complete one low-cost project task.",
            }
          : review,
      ),
    );
  return (
    <div className="page">
      <SectionHeader
        eyebrow="See the story, not just the totals"
        title="Reviews"
        description="A calm summary of what changed, what worked, and where to focus next."
      />
      <div className="reviews-grid">
        {state.reviews.map((review) => (
          <article className="stack-card review-card" key={review.id}>
            <div className="review-head">
              <span
                className={`review-icon ${review.type === "weekly" ? "weekly" : "monthly"}`}
              >
                {review.type === "weekly" ? (
                  <CalendarClock size={20} />
                ) : (
                  <Gauge size={20} />
                )}
              </span>
              <div>
                <span className="eyebrow">{review.type} review</span>
                <h2>{review.period}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => regenerate(review.id)}
                aria-label="Regenerate review"
              >
                <RefreshCw size={17} />
              </button>
            </div>
            <div className="review-metrics">
              <span>
                <small>Income</small>
                <strong>{money(review.income)}</strong>
              </span>
              <span>
                <small>Spending</small>
                <strong>{money(review.spending)}</strong>
              </span>
              <span>
                <small>Savings</small>
                <strong className="positive">
                  +{money(review.savingsChange)}
                </strong>
              </span>
              <span>
                <small>Debt</small>
                <strong className="positive">
                  {money(review.debtChange)}
                </strong>
              </span>
            </div>
            <div className="review-section">
              <h3>Wins</h3>
              {review.wins.map((win) => (
                <p key={win}>
                  <CheckCircle2 size={15} /> {win}
                </p>
              ))}
            </div>
            <div className="review-focus">
              <Lightbulb size={18} />
              <p>
                <strong>Suggested focus</strong>
                {review.focus}
              </p>
            </div>
            <button className="secondary-button">
              <Download size={15} /> Export review
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function AccountsView({
  state,
  openModal,
  connectPlaid,
  syncBank,
  syncing,
}: {
  state: StewardState;
  openModal: (modal: ModalName) => void;
  connectPlaid: () => void;
  syncBank: () => void;
  syncing: boolean;
}) {
  return (
    <div className="page">
      <SectionHeader
        eyebrow="Your financial foundation"
        title="Accounts"
        description="Connected and manual balances used across every Steward decision."
        action={
          <div className="button-row">
            <button className="secondary-button" onClick={connectPlaid}>
              <Landmark size={16} /> Connect bank
            </button>
            <button className="primary-button" onClick={() => openModal("account")}>
              <Plus size={16} /> Manual account
            </button>
          </div>
        }
      />
      <div className="accounts-summary">
        <div>
          <span>Assets</span>
          <strong>
            {money(
              state.accounts
                .filter((account) => account.type !== "Credit card")
                .reduce((sum, account) => sum + account.balance, 0),
            )}
          </strong>
        </div>
        <ArrowRight size={20} />
        <div>
          <span>Debt</span>
          <strong>
            {money(
              state.accounts
                .filter((account) => account.type === "Credit card")
                .reduce((sum, account) => sum + account.balance, 0),
            )}
          </strong>
        </div>
        <ArrowRight size={20} />
        <div className="net">
          <span>Tracked net position</span>
          <strong>
            {money(
              state.accounts.reduce(
                (sum, account) =>
                  sum +
                  (account.type === "Credit card"
                    ? -account.balance
                    : account.balance),
                0,
              ),
            )}
          </strong>
        </div>
      </div>
      <div className="account-grid">
        {state.accounts.map((account) => (
          <article className="stack-card account-card" key={account.id}>
            <div className="account-top">
              <span
                className={`account-icon ${account.type.toLowerCase().replace(" ", "-")}`}
              >
                {account.type === "Credit card" ? (
                  <CreditCard size={21} />
                ) : account.type === "Investment" ? (
                  <TrendingUp size={21} />
                ) : (
                  <Landmark size={21} />
                )}
              </span>
              <div>
                <Pill tone={account.status === "attention" ? "amber" : "green"}>
                  {account.status === "connected"
                    ? "Connected"
                    : account.status === "manual"
                      ? "Manual"
                      : "Reconnect"}
                </Pill>
                <button className="icon-button" aria-label="Account options">
                  <MoreHorizontal size={17} />
                </button>
              </div>
            </div>
            <span className="eyebrow">{account.institution}</span>
            <h2>{account.name}</h2>
            <strong className="account-balance">{money(account.balance)}</strong>
            <small>
              {account.type === "Credit card"
                ? `${money(account.available)} available`
                : `${money(account.available)} available now`}
            </small>
            {account.type === "Credit card" && account.creditLimit && (
              <div className="credit-utilization">
                <span>
                  <b>
                    {Math.round((account.balance / account.creditLimit) * 100)}%
                    used
                  </b>
                  <small>{money(account.creditLimit)} limit</small>
                </span>
                <Progress
                  value={(account.balance / account.creditLimit) * 100}
                  tone="amber"
                />
              </div>
            )}
            <div className="account-footer">
              <span>
                <RefreshCw size={13} /> {account.lastSynced}
              </span>
              <button onClick={syncBank} disabled={syncing}>
                {syncing ? "Syncing…" : "Update"}
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="integration-note">
        <Landmark size={20} />
        <div>
          <strong>Secure bank sync is active</strong>
          <p>
            Plaid handles bank authentication. Steward stores encrypted access
            tokens and imports balances, transactions, and supported recurring
            cash flows.
          </p>
        </div>
        <button className="secondary-button" onClick={syncBank} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"} <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}

function SettingsView({
  state,
  update,
  openModal,
  saveState,
}: {
  state: StewardState;
  update: <K extends keyof StewardState>(key: K, value: StewardState[K]) => void;
  openModal: (modal: ModalName) => void;
  saveState: string;
}) {
  const [tab, setTab] = useState<
    "profile" | "memory" | "notifications" | "privacy"
  >("profile");
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `steward-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () => {
    const rows = [
      ["date", "merchant", "description", "amount", "category", "type"],
      ...state.transactions.map((transaction) => [
        transaction.date,
        transaction.merchant,
        transaction.description,
        transaction.amount,
        transaction.category,
        transaction.type,
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "steward-transactions.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="page">
      <SectionHeader
        eyebrow="Your Steward"
        title="Settings"
        description="Control the assumptions, memory, privacy, and tone behind your recommendations."
        action={
          <Pill tone={saveState === "offline" ? "amber" : "green"}>
            {saveState === "offline" ? "Session-only changes" : "All changes saved"}
          </Pill>
        }
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {[
            ["profile", "Profile & plan", Settings],
            ["memory", "AI memory", Sparkles],
            ["notifications", "Notifications", Bell],
            ["privacy", "Privacy & data", ShieldCheck],
          ].map(([id, label, Icon]) => (
            <button
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id as typeof tab)}
              key={id as string}
            >
              <Icon size={17} /> {label as string}
            </button>
          ))}
        </nav>
        <div className="settings-panel stack-card">
          {tab === "profile" && (
            <>
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">Personal details</span>
                  <h2>Profile & financial preferences</h2>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => openModal("onboarding")}
                >
                  Run onboarding again
                </button>
              </div>
              <div className="form-grid">
                <Field label="Name">
                  <input
                    value={state.profile.name}
                    onChange={(event) =>
                      update("profile", {
                        ...state.profile,
                        name: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Currency">
                  <select
                    value={state.profile.currency}
                    onChange={(event) =>
                      update("profile", {
                        ...state.profile,
                        currency: event.target.value as typeof state.profile.currency,
                      })
                    }
                  >
                    <option value="USD">USD — US dollar</option>
                    <option value="EUR">EUR — Euro</option>
                    <option value="GBP">GBP — British pound</option>
                    <option value="CAD">CAD — Canadian dollar</option>
                  </select>
                </Field>
                <Field label="Pay frequency">
                  <select
                    value={state.profile.payFrequency}
                    onChange={(event) =>
                      update("profile", {
                        ...state.profile,
                        payFrequency: event.target
                          .value as typeof state.profile.payFrequency,
                      })
                    }
                  >
                    <option>Weekly</option>
                    <option>Biweekly</option>
                    <option>Monthly</option>
                  </select>
                </Field>
                <Field label="Typical take-home paycheck">
                  <input
                    type="number"
                    value={state.profile.takeHomePay}
                    onChange={(event) =>
                      update("profile", {
                        ...state.profile,
                        takeHomePay: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Minimum checking buffer"
                  hint="Steward protects this before recommending purchases."
                >
                  <input
                    type="number"
                    value={state.profile.minimumBuffer}
                    onChange={(event) =>
                      update("profile", {
                        ...state.profile,
                        minimumBuffer: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Risk tolerance">
                  <select
                    value={state.profile.riskTolerance}
                    onChange={(event) =>
                      update("profile", {
                        ...state.profile,
                        riskTolerance: event.target
                          .value as typeof state.profile.riskTolerance,
                      })
                    }
                  >
                    <option>Cautious</option>
                    <option>Balanced</option>
                    <option>Flexible</option>
                  </select>
                </Field>
                <Field label="Appearance">
                  <select
                    value={state.profile.theme}
                    onChange={(event) =>
                      update("profile", {
                        ...state.profile,
                        theme: event.target.value as typeof state.profile.theme,
                      })
                    }
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">Use device setting</option>
                  </select>
                </Field>
              </div>
            </>
          )}
          {tab === "memory" && (
            <>
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">Explainable personalization</span>
                  <h2>What Steward remembers</h2>
                  <p>
                    Structured preferences only. Edit or delete anything at any
                    time.
                  </p>
                </div>
              </div>
              <div className="memory-list">
                {state.memories.map((memory) => (
                  <div className="memory-row" key={memory.id}>
                    <span className={`memory-icon ${memory.category.toLowerCase()}`}>
                      <Sparkles size={17} />
                    </span>
                    <div>
                      <span>
                        <strong>{memory.label}</strong>
                        <Pill>{memory.category}</Pill>
                      </span>
                      <p>{memory.value}</p>
                    </div>
                    <button
                      className="icon-button"
                      onClick={() =>
                        update(
                          "memories",
                          state.memories.filter((item) => item.id !== memory.id),
                        )
                      }
                      aria-label={`Delete ${memory.label}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "notifications" && (
            <>
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">Stay ahead, quietly</span>
                  <h2>Notification preferences</h2>
                </div>
              </div>
              <div className="toggle-list">
                {Object.entries(state.notificationPreferences).map(
                  ([key, enabled]) => (
                    <label key={key}>
                      <span>
                        <strong>
                          {key
                            .replace(/([A-Z])/g, " $1")
                            .replace(/^./, (letter) => letter.toUpperCase())}
                        </strong>
                        <small>
                          {key === "marketing"
                            ? "Occasional product news"
                            : "In-app now; email-ready architecture"}
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() =>
                          update("notificationPreferences", {
                            ...state.notificationPreferences,
                            [key]: !enabled,
                          })
                        }
                      />
                    </label>
                  ),
                )}
              </div>
            </>
          )}
          {tab === "privacy" && (
            <>
              <div className="settings-section-head">
                <div>
                  <span className="eyebrow">You stay in control</span>
                  <h2>Privacy & data</h2>
                  <p>
                    Your workspace is isolated by authenticated identity in
                    production. Financial access tokens are never sent to the
                    browser.
                  </p>
                </div>
              </div>
              <div className="privacy-actions">
                <div>
                  <span className="privacy-icon">
                    <Download size={19} />
                  </span>
                  <div>
                    <strong>Export your data</strong>
                    <p>
                      Download your full workspace as JSON or transaction
                      history as CSV.
                    </p>
                  </div>
                  <span className="button-row">
                    <button className="secondary-button" onClick={exportJson}>
                      JSON
                    </button>
                    <button className="secondary-button" onClick={exportCsv}>
                      CSV
                    </button>
                  </span>
                </div>
                <div>
                  <span className="privacy-icon">
                    <ShieldCheck size={19} />
                  </span>
                  <div>
                    <strong>AI privacy</strong>
                    <p>
                      Critical arithmetic runs locally in deterministic code.
                      External AI explanations are disabled until you add a key.
                    </p>
                  </div>
                  <Pill tone="green">Protected</Pill>
                </div>
                <div className="danger-row">
                  <span className="privacy-icon">
                    <Trash2 size={19} />
                  </span>
                  <div>
                    <strong>Delete account data</strong>
                    <p>
                      Permanently remove the workspace, memories, and audit
                      records.
                    </p>
                  </div>
                  <button
                    className="danger-button"
                    onClick={() => openModal("delete")}
                  >
                    Delete data
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EntityModal({
  modal,
  state,
  setState,
  close,
  onboardingStep,
  setOnboardingStep,
}: {
  modal: Exclude<ModalName, null>;
  state: StewardState;
  setState: React.Dispatch<React.SetStateAction<StewardState>>;
  close: () => void;
  onboardingStep: number;
  setOnboardingStep: (step: number) => void;
}) {
  const form = (event: FormEvent<HTMLFormElement>) =>
    new FormData(event.currentTarget);

  if (modal === "delete") {
    const deleteWorkspace = async () => {
      await fetch("/api/steward", { method: "DELETE" });
      setState(createEmptyState(state.profile.name, state.profile.email));
      close();
    };
    return (
      <Modal title="Delete your Steward data?" eyebrow="Permanent action" onClose={close}>
        <div className="delete-confirm">
          <span><Trash2 size={24} /></span>
          <p>
            This removes the saved workspace and audit history for this account.
            Connected financial credentials are revoked as part of deletion.
          </p>
          <div className="button-row end">
            <button className="secondary-button" onClick={close}>Cancel</button>
            <button className="danger-button" onClick={deleteWorkspace}>Delete permanently</button>
          </div>
        </div>
      </Modal>
    );
  }

  if (modal === "onboarding") {
    const steps = [
      {
        title: "Let’s start with your rhythm",
        body: "Steward uses your pay cycle as the primary planning unit.",
      },
      {
        title: "Protect your foundation",
        body: "Set the balance Steward should preserve before recommending purchases.",
      },
      {
        title: "Choose what matters now",
        body: "Your priorities shape every recommendation.",
      },
      {
        title: "Your first plan is ready",
        body: "You can adjust every assumption later.",
      },
    ];
    return (
      <Modal
        title={steps[onboardingStep].title}
        eyebrow={`Setup ${onboardingStep + 1} of ${steps.length}`}
        onClose={close}
      >
        <div className="onboarding">
          <Progress value={((onboardingStep + 1) / steps.length) * 100} />
          <p>{steps[onboardingStep].body}</p>
          {onboardingStep === 0 && (
            <div className="form-grid">
              <Field label="Name">
                <input
                  value={state.profile.name}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      profile: { ...current.profile, name: event.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="Pay frequency">
                <select
                  value={state.profile.payFrequency}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      profile: {
                        ...current.profile,
                        payFrequency: event.target
                          .value as typeof current.profile.payFrequency,
                      },
                    }))
                  }
                >
                  <option>Weekly</option>
                  <option>Biweekly</option>
                  <option>Monthly</option>
                </select>
              </Field>
              <Field label="Take-home paycheck">
                <input
                  type="number"
                  value={state.profile.takeHomePay}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      profile: {
                        ...current.profile,
                        takeHomePay: Number(event.target.value),
                      },
                    }))
                  }
                />
              </Field>
              <Field label="Next payday">
                <input
                  type="date"
                  value={state.profile.nextPayday}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      profile: {
                        ...current.profile,
                        nextPayday: event.target.value,
                      },
                    }))
                  }
                />
              </Field>
            </div>
          )}
          {onboardingStep === 1 && (
            <div className="form-grid">
              <Field label="Checking balance">
                <input
                  type="number"
                  value={
                    state.accounts.find(
                      (account) => account.type === "Checking",
                    )?.balance ?? 0
                  }
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      accounts: current.accounts.map((account) =>
                        account.type === "Checking"
                          ? {
                              ...account,
                              balance: Number(event.target.value),
                              available: Number(event.target.value),
                            }
                          : account,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="Savings balance">
                <input
                  type="number"
                  value={
                    state.accounts.find(
                      (account) => account.type === "Savings",
                    )?.balance ?? 0
                  }
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      accounts: current.accounts.map((account) =>
                        account.type === "Savings"
                          ? {
                              ...account,
                              balance: Number(event.target.value),
                              available: Number(event.target.value),
                            }
                          : account,
                      ),
                    }))
                  }
                />
              </Field>
              <Field
                label="Minimum checking buffer"
                hint="A comfortable floor, not a spending target."
              >
                <input
                  type="number"
                  value={state.profile.minimumBuffer}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      profile: {
                        ...current.profile,
                        minimumBuffer: Number(event.target.value),
                      },
                    }))
                  }
                />
              </Field>
              <Field label="Financial confidence">
                <select
                  value={state.profile.riskTolerance}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      profile: {
                        ...current.profile,
                        riskTolerance: event.target
                          .value as typeof current.profile.riskTolerance,
                      },
                    }))
                  }
                >
                  <option>Cautious</option>
                  <option>Balanced</option>
                  <option>Flexible</option>
                </select>
              </Field>
            </div>
          )}
          {onboardingStep === 2 && (
            <div className="priority-options">
              {["Build emergency savings", "Pay down debt", "Improve my home", "Invest in career", "Plan travel"].map(
                (priority, index) => (
                  <button
                    key={priority}
                    className={index < 2 ? "selected" : ""}
                    type="button"
                  >
                    <span>{index < 2 && <Check size={14} />}</span>
                    {priority}
                  </button>
                ),
              )}
            </div>
          )}
          {onboardingStep === 3 && (
            <div className="onboarding-result">
              <span><Sparkles size={22} /></span>
              <h3>{money(calculateTradeoffs(state).safeToSpend)} is safely available today</h3>
              <p>
                Steward has reserved upcoming bills, required payments,
                savings, and your {money(state.profile.minimumBuffer)} buffer.
              </p>
              <div>
                <span>Bills protected <b>{money(calculateTradeoffs(state).billsBeforePayday)}</b></span>
                <span>Suggested debt payment <b>{money(state.paycheckPlan.debt)}</b></span>
                <span>Suggested savings <b>{money(state.paycheckPlan.savings)}</b></span>
              </div>
            </div>
          )}
          <div className="onboarding-actions">
            <button
              className="text-button"
              onClick={() =>
                onboardingStep === 0
                  ? close()
                  : setOnboardingStep(onboardingStep - 1)
              }
            >
              {onboardingStep === 0 ? "Skip for now" : "Back"}
            </button>
            <button
              className="primary-button"
              onClick={() => {
                if (onboardingStep === steps.length - 1) {
                  setState((current) => ({
                    ...current,
                    profile: {
                      ...current.profile,
                      onboardingComplete: true,
                    },
                  }));
                  close();
                } else {
                  setOnboardingStep(onboardingStep + 1);
                }
              }}
            >
              {onboardingStep === steps.length - 1
                ? "Open my plan"
                : "Continue"}{" "}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = form(event);
    if (modal === "account") {
      const type = data.get("type") as AccountType;
      const balance = Number(data.get("balance"));
      const account: Account = {
        id: uid("account"),
        name: String(data.get("name")),
        institution: String(data.get("institution")),
        type,
        balance,
        available:
          type === "Credit card"
            ? Number(data.get("creditLimit")) - balance
            : balance,
        creditLimit:
          type === "Credit card" ? Number(data.get("creditLimit")) : undefined,
        interestRate:
          type === "Credit card" ? Number(data.get("interestRate")) : undefined,
        source: "manual",
        status: "manual",
        lastSynced: "Just now",
      };
      setState((current) => ({
        ...current,
        accounts: [...current.accounts, account],
      }));
    }
    if (modal === "transaction") {
      const merchant = String(data.get("merchant"));
      const chosenCategory = String(data.get("category"));
      const transaction: Transaction = {
        id: uid("transaction"),
        accountId: String(data.get("accountId")),
        merchant,
        description: String(data.get("description")),
        amount: Number(data.get("amount")),
        date: String(data.get("date")),
        category:
          chosenCategory ||
          deterministicCategory(merchant, String(data.get("description"))),
        type: data.get("type") as Transaction["type"],
        confidence: 1,
        categorySource: chosenCategory ? "manual" : "rule",
      };
      setState((current) => ({
        ...current,
        transactions: [transaction, ...current.transactions],
      }));
    }
    if (modal === "project") {
      const project: Project = {
        id: uid("project"),
        name: String(data.get("name")),
        description: String(data.get("description")),
        category: String(data.get("category")),
        priority: data.get("priority") as Project["priority"],
        status: "Planned",
        targetDate: String(data.get("targetDate")),
        estimatedCost: Number(data.get("estimatedCost")),
        actualCost: 0,
        progress: 0,
        nextAction: String(data.get("nextAction")),
        tasks: [],
      };
      setState((current) => ({
        ...current,
        projects: [...current.projects, project],
      }));
    }
    if (modal === "wishlist") {
      const price = Number(data.get("price"));
      const safe = calculateTradeoffs(state).safeToSpend >= price;
      const item: WishlistItem = {
        id: uid("wish"),
        name: String(data.get("name")),
        projectId: String(data.get("projectId")) || undefined,
        category: String(data.get("category")),
        priority: data.get("priority") as WishlistItem["priority"],
        price,
        desiredDate: String(data.get("desiredDate")),
        safeDate: safe
          ? new Date().toISOString().slice(0, 10)
          : state.profile.nextPayday,
        status: safe ? "Recommended now" : "Wait",
        reason: safe
          ? "This fits the current safe-to-spend amount without disturbing protected priorities."
          : "Waiting until the next paycheck keeps the protected buffer intact.",
        url: String(data.get("url")) || undefined,
      };
      setState((current) => ({
        ...current,
        wishlist: [...current.wishlist, item],
      }));
    }
    if (modal === "goal") {
      const goal: Goal = {
        id: uid("goal"),
        name: String(data.get("name")),
        type: String(data.get("type")),
        target: Number(data.get("target")),
        current: Number(data.get("current")),
        targetDate: String(data.get("targetDate")),
        priority: data.get("priority") as Goal["priority"],
        status: "Active",
        recommendedContribution: Number(data.get("contribution")),
      };
      setState((current) => ({
        ...current,
        goals: [...current.goals, goal],
      }));
    }
    if (modal === "bill") {
      const bill: Bill = {
        id: uid("bill"),
        name: String(data.get("name")),
        amount: Number(data.get("amount")),
        dueDate: String(data.get("dueDate")),
        frequency: data.get("frequency") as Bill["frequency"],
        autopay: data.get("autopay") === "on",
        essential: data.get("essential") === "on",
        accountId: String(data.get("accountId")),
      };
      setState((current) => ({
        ...current,
        bills: [...current.bills, bill],
      }));
    }
    close();
  };

  const titles: Record<Exclude<ModalName, null>, string> = {
    account: "Add a manual account",
    transaction: "Add a transaction",
    project: "Create a project",
    wishlist: "Add to your wishlist",
    goal: "Create a goal",
    bill: "Add a bill",
    onboarding: "Set up Steward",
    delete: "Delete data",
  };

  return (
    <Modal title={titles[modal]} eyebrow="Steward workspace" onClose={close}>
      <form className="entity-form" onSubmit={submit}>
        {(modal === "account" ||
          modal === "project" ||
          modal === "wishlist" ||
          modal === "goal" ||
          modal === "bill") && (
          <Field label="Name">
            <input name="name" required autoFocus />
          </Field>
        )}
        {modal === "account" && (
          <>
            <div className="form-grid">
              <Field label="Institution">
                <input name="institution" required />
              </Field>
              <Field label="Account type">
                <select name="type">
                  {[
                    "Checking",
                    "Savings",
                    "Credit card",
                    "Loan",
                    "Investment",
                    "Cash",
                    "Other",
                  ].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <Field label="Current balance">
                <input name="balance" type="number" step="0.01" required />
              </Field>
              <Field label="Credit limit (if applicable)">
                <input name="creditLimit" type="number" step="0.01" />
              </Field>
              <Field label="Interest rate (if applicable)">
                <input name="interestRate" type="number" step="0.01" />
              </Field>
            </div>
          </>
        )}
        {modal === "transaction" && (
          <>
            <div className="form-grid">
              <Field label="Merchant">
                <input name="merchant" required autoFocus />
              </Field>
              <Field label="Amount">
                <input name="amount" type="number" step="0.01" required />
              </Field>
              <Field label="Date">
                <input
                  name="date"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  required
                />
              </Field>
              <Field label="Account">
                <select name="accountId">
                  {state.accounts.map((account) => (
                    <option value={account.id} key={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type">
                <select name="type">
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
                </select>
              </Field>
              <Field label="Category">
                <select name="category">
                  <option value="">Choose automatically</option>
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Description or note">
              <input name="description" />
            </Field>
          </>
        )}
        {modal === "project" && (
          <>
            <Field label="Why this matters">
              <textarea name="description" rows={3} />
            </Field>
            <div className="form-grid">
              <Field label="Category">
                <input name="category" placeholder="Home, career, hobby…" required />
              </Field>
              <Field label="Priority">
                <select name="priority">
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </Field>
              <Field label="Estimated total cost">
                <input name="estimatedCost" type="number" required />
              </Field>
              <Field label="Target date">
                <input name="targetDate" type="date" required />
              </Field>
            </div>
            <Field label="First next action">
              <input name="nextAction" required />
            </Field>
          </>
        )}
        {modal === "wishlist" && (
          <>
            <div className="form-grid">
              <Field label="Estimated price">
                <input name="price" type="number" step="0.01" required />
              </Field>
              <Field label="Project">
                <select name="projectId">
                  <option value="">No project</option>
                  {state.projects.map((project) => (
                    <option value={project.id} key={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <input name="category" required />
              </Field>
              <Field label="Priority">
                <select name="priority">
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </Field>
              <Field label="Desired date">
                <input name="desiredDate" type="date" required />
              </Field>
              <Field label="Product URL (optional)">
                <input name="url" type="url" />
              </Field>
            </div>
          </>
        )}
        {modal === "goal" && (
          <div className="form-grid">
            <Field label="Goal type">
              <select name="type">
                <option>Emergency fund</option>
                <option>Debt payoff</option>
                <option>Purchase</option>
                <option>Travel</option>
                <option>Education</option>
                <option>Business</option>
                <option>Custom</option>
              </select>
            </Field>
            <Field label="Priority">
              <select name="priority">
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </Field>
            <Field label="Target amount">
              <input name="target" type="number" required />
            </Field>
            <Field label="Current amount">
              <input name="current" type="number" defaultValue={0} required />
            </Field>
            <Field label="Target date">
              <input name="targetDate" type="date" required />
            </Field>
            <Field label="Recommended contribution">
              <input name="contribution" type="number" required />
            </Field>
          </div>
        )}
        {modal === "bill" && (
          <div className="form-grid">
            <Field label="Amount">
              <input name="amount" type="number" step="0.01" required />
            </Field>
            <Field label="Next due date">
              <input name="dueDate" type="date" required />
            </Field>
            <Field label="Frequency">
              <select name="frequency">
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="annual">Annual</option>
                <option value="one-time">One time</option>
              </select>
            </Field>
            <Field label="Payment account">
              <select name="accountId">
                {state.accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="check-field">
              <input name="autopay" type="checkbox" /> Autopay enabled
            </label>
            <label className="check-field">
              <input name="essential" type="checkbox" defaultChecked /> Essential obligation
            </label>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Save <Check size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
