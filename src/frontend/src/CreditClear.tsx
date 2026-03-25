import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "./auth";
import { Status, type backendInterface } from "./backend";
import { useActor } from "./hooks/useActor";

// ═══════════════════════════════════════════════════════════════
// FCRA/CROA KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════
const FCRA_SYS = `You are an expert credit repair analyst and dispute letter generator with deep knowledge of the Fair Credit Reporting Act (FCRA), 15 U.S.C. §1681 et seq., and the Credit Repair Organizations Act (CROA), 15 U.S.C. §1679 et seq.

FCRA KEY PROVISIONS:
§611 (15 U.S.C. §1681i): CRAs must investigate disputes within 30 days (45 if consumer adds info). Forward to furnisher in 5 biz days. Delete/modify unverifiable items. Written results in 5 biz days. Free updated report.
§609 (15 U.S.C. §1681g): Right to all info in file, sources, who accessed report. 1 free report/year per bureau.
§605 (15 U.S.C. §1681c): Most negatives: 7 years from date of first delinquency. Ch.7 bankruptcy: 10 years. Ch.13: 7 years. Collections: 7 from original delinquency. Inquiries: 2 years. Re-aging is ILLEGAL.
§604 (15 U.S.C. §1681b): CRA may only furnish for: credit, employment (written consent), insurance, consumer-initiated transactions, court orders, account review. Unauthorized = violation.
§623 (15 U.S.C. §1681s-2): Furnishers must report accurate/complete info. Investigate CRA-forwarded disputes. Correct/delete inaccurate data. §623(b) private right of action.
§605B (15 U.S.C. §1681c-2): Block ID theft items within 4 biz days.
§616 (15 U.S.C. §1681n): Willful: $100-$1,000 statutory + punitive + attorney fees.
§617 (15 U.S.C. §1681o): Negligent: actual damages + attorney fees.
§615 (15 U.S.C. §1681m): Adverse action notice required.

CROA KEY PROVISIONS:
§1679b: Cannot charge before services performed, advise false statements, advise identity alteration.
§1679c: Must disclose: right to dispute directly, free reports, accurate info can't be removed, 3-day cancel.
§1679e: 3 business day cancel right. §1679g: Actual + punitive + attorney fees. Void contracts. 5-year SOL.

LETTER GUIDELINES: Cite specific U.S.C. refs. Formal assertive tone. Include consumer ID. Reference dispute reason with specifics. State legal obligations. Include deadlines & consequences. Reference §616/§617. Recommend certified mail. List enclosures. For ID theft: §605B. For obsolete: §605 time limits. For inquiries: §604. For furnisher disputes: §623(b). Never advise false statements per CROA §1679b.`;

const ANALYSIS_SYS = `${FCRA_SYS}

REPORT ANALYSIS MODE: Analyze the credit report to identify ALL potentially disputable items.
Respond with ONLY a valid JSON array. No commentary, no markdown, no code blocks.
Each element: {"account":"string","accountNumber":"string or empty","issue":"not_mine|inaccurate_balance|inaccurate_status|late_payment_error|duplicate|obsolete|unauthorized_inquiry|identity_theft|paid_not_updated|wrong_dates|wrong_creditor|mixed_file|high_utilization|missing_info|generic_inaccuracy","issueLabel":"human label","severity":"high|medium|low","fcraSections":"applicable sections","explanation":"why disputable","suggestedAction":"what to do"}

Look for: accounts not belonging to consumer, wrong balances, past-7yr items, inaccurate late payments, duplicates, unauthorized inquiries, wrong personal info, open-should-be-closed, paid-still-showing-balance, re-aging, any inaccuracy. Be thorough. If clean, return [].
RESPOND WITH ONLY THE JSON ARRAY.`;

const LETTER_SYS = `${FCRA_SYS}\nGenerate the letter as a complete ready-to-send document. Include date, consumer info, bureau/furnisher address, re: line, body with legal citations, closing, enclosure list. Output ONLY the letter text.`;

// ═══════════════════════════════════════════════════════════
// VENICE AI
const HARDCODED_KEY =
  "VENICE_INFERENCE_KEY_PTkGVuBBS8A88qsGYMfcp5E5KyfY3FfuQ_jQCgiQ7U";
// ═══════════════════════════════════════════════════════════
const VURL = "https://api.venice.ai/api/v1/chat/completions";
async function venice(
  key: string,
  sys: string,
  usr: string,
  temp = 0.3,
): Promise<string> {
  const r = await fetch(VURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      max_tokens: 8000,
      temperature: temp,
      venice_parameters: { include_venice_system_prompt: false },
    }),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(e.error?.message || `Venice API error: ${r.status}`);
  }
  const d = (await r.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (d.choices?.[0]?.message?.content ?? "")
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
}

interface FlaggedItem {
  account: string;
  accountNumber: string;
  issue: string;
  issueLabel: string;
  severity: "high" | "medium" | "low";
  fcraSections: string;
  explanation: string;
  suggestedAction: string;
}

async function analyzeReport(
  key: string,
  text: string,
): Promise<FlaggedItem[]> {
  const raw = await venice(
    key,
    ANALYSIS_SYS,
    `Analyze this credit report and identify ALL disputable items. Return ONLY a JSON array.\n\nCREDIT REPORT:\n\n${text}`,
    0.2,
  );
  const s = raw.indexOf("[");
  const e = raw.lastIndexOf("]");
  if (s === -1 || e === -1)
    throw new Error("AI did not return valid analysis.");
  return JSON.parse(raw.slice(s, e + 1)) as FlaggedItem[];
}

interface Bureau {
  id: string;
  name: string;
  address: string;
}
interface Furnisher {
  name: string;
  address: string;
}

async function genLetter(
  key: string,
  ci: ClientLocal,
  item: FlaggedItem,
  bureau: string,
  target: string,
  fi: Furnisher,
): Promise<string> {
  const bd = BUREAUS.find((b) => b.id === bureau);
  const p = `Generate a formal FCRA dispute letter:\n\nCONSUMER:\n- Name: ${ci.fullName}\n- Address: ${ci.address}\n- City/State/ZIP: ${ci.cityStateZip}\n- SSN Last 4: ${ci.ssnLast4 || "XXXX"}\n\nTARGET: ${
    target === "bureau"
      ? `Credit Bureau — ${bd?.name}\n${bd?.address}`
      : `Furnisher — ${fi?.name || item.account}\n${fi?.address || "[ADDRESS]"}`
  }\n\nDISPUTED ITEM:\n- Account: ${item.account}\n- Account #: ${item.accountNumber || "[ACCOUNT NUMBER]"}\n- Issue: ${item.issueLabel}\n- Details: ${item.explanation}\n- FCRA Sections: ${item.fcraSections}\n\nThis is a ${target === "bureau" ? "§611 CRA dispute" : "§623(b) furnisher dispute"}.\nToday: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.\nOutput ONLY the letter.`;
  return await venice(key, LETTER_SYS, p, 0.3);
}

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════
const BUREAUS: Bureau[] = [
  {
    id: "equifax",
    name: "Equifax",
    address: "P.O. Box 740256\nAtlanta, GA 30374",
  },
  {
    id: "experian",
    name: "Experian",
    address: "P.O. Box 4500\nAllen, TX 75013",
  },
  {
    id: "transunion",
    name: "TransUnion",
    address: "P.O. Box 2000\nChester, PA 19016",
  },
];
const SEV: Record<string, { c: string; bg: string; b: string; l: string }> = {
  high: {
    c: "#ef6461",
    bg: "rgba(239,100,97,.1)",
    b: "rgba(239,100,97,.25)",
    l: "High",
  },
  medium: {
    c: "#fbbf24",
    bg: "rgba(251,191,36,.1)",
    b: "rgba(251,191,36,.25)",
    l: "Med",
  },
  low: {
    c: "#5b9cf6",
    bg: "rgba(91,156,246,.1)",
    b: "rgba(91,156,246,.25)",
    l: "Low",
  },
};
const ICONS: Record<string, string> = {
  not_mine: "🚫",
  inaccurate_balance: "💰",
  inaccurate_status: "📊",
  late_payment_error: "📅",
  duplicate: "📋",
  obsolete: "⌛",
  unauthorized_inquiry: "🔍",
  identity_theft: "🛡",
  paid_not_updated: "✅",
  wrong_dates: "🗓",
  wrong_creditor: "🏦",
  mixed_file: "👥",
  high_utilization: "📈",
  missing_info: "❓",
  generic_inaccuracy: "⚠️",
};
const FCRA_REF = [
  {
    s: "§611",
    u: "15 U.S.C. §1681i",
    t: "Dispute Procedure",
    sum: "CRAs must investigate within 30 days, forward in 5 biz days, delete unverifiable items.",
    use: "Disputing any inaccurate item",
  },
  {
    s: "§609",
    u: "15 U.S.C. §1681g",
    t: "Consumer Disclosures",
    sum: "Right to all info in file, sources, access history. 1 free report/year per bureau.",
    use: "Requesting your full file",
  },
  {
    s: "§605",
    u: "15 U.S.C. §1681c",
    t: "Reporting Time Limits",
    sum: "Most negatives: 7 yrs. Ch.7: 10 yrs. Ch.13: 7 yrs. Inquiries: 2 yrs. Re-aging illegal.",
    use: "Removing obsolete items",
  },
  {
    s: "§623",
    u: "15 U.S.C. §1681s-2",
    t: "Furnisher Duties",
    sum: "Must report accurately, investigate disputes, correct/delete. §623(b) private right of action.",
    use: "Disputing with creditors directly",
  },
  {
    s: "§604",
    u: "15 U.S.C. §1681b",
    t: "Permissible Purposes",
    sum: "CRAs may only share for authorized purposes. Unauthorized access = violation.",
    use: "Challenging unauthorized inquiries",
  },
  {
    s: "§605B",
    u: "15 U.S.C. §1681c-2",
    t: "ID Theft Blocking",
    sum: "Must block within 4 biz days with proof.",
    use: "Blocking fraudulent accounts",
  },
  {
    s: "§616/617",
    u: "15 U.S.C. §1681n/o",
    t: "Civil Liability",
    sum: "Willful: $100–$1,000 + punitive + fees. Negligent: actual + fees.",
    use: "When corrections aren't made",
  },
];
const CROA_REF = [
  {
    s: "§1679b",
    t: "Prohibited Practices",
    sum: "Can't charge before services, advise false statements, suggest ID alteration.",
    use: "What repair companies CANNOT do",
  },
  {
    s: "§1679c",
    t: "Required Disclosures",
    sum: "Must disclose: dispute directly, free reports, accurate info stays, 3-day cancel.",
    use: "Your rights before hiring anyone",
  },
  {
    s: "§1679e",
    t: "Right to Cancel",
    sum: "Cancel any contract within 3 business days.",
    use: "Canceling credit repair contracts",
  },
  {
    s: "§1679g",
    t: "Civil Liability",
    sum: "Actual + punitive + fees. VOID contracts. 5-year SOL.",
    use: "Action against deceptive companies",
  },
];
const CHECKLIST = [
  "Pull free reports from AnnualCreditReport.com (all 3 bureaus)",
  "Review line-by-line: personal info, accounts, inquiries, public records",
  "Document every inaccuracy with account numbers, dates, specifics",
  "Gather supporting docs: statements, receipts, ID theft reports",
  "Send disputes via CERTIFIED MAIL with return receipt (USPS 3811)",
  "Keep copies of ALL correspondence and green cards",
  "Track the 30-day deadline from bureau receipt date",
  "Follow up citing §611(a)(5) and §616 if not corrected",
  "File CFPB complaint at consumerfinance.gov/complaint",
  "Consult consumer rights attorney for §616/617 claims",
];

// ═══════════════════════════════════════════════════════════
// LOCAL TYPES
// ═══════════════════════════════════════════════════════════
interface ClientLocal {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  cityStateZip: string;
  ssnLast4: string;
  notes: string;
  createdAt: string;
  disputeCount: number;
  resolvedCount: number;
  status: string;
}

interface DisputeLocal {
  id: number;
  clientId: number;
  clientName: string;
  account: string;
  bureau: string;
  reason: string;
  status: Status;
  date: string;
  daysLeft: number;
}

interface LetterResult {
  item: FlaggedItem;
  text: string | null;
  error: string | null;
}

const EMPTY_CLIENT_FORM = {
  fullName: "",
  email: "",
  phone: "",
  address: "",
  cityStateZip: "",
  ssnLast4: "",
  notes: "",
};

export default function CreditClear() {
  const { logout } = useAuth();
  const { actor } = useActor();
  const [tab, setTab] = useState("clients");
  const [checks, setChecks] = useState<boolean[]>(
    new Array(CHECKLIST.length).fill(false),
  );
  const [dataLoading, setDataLoading] = useState(true);

  // ── Client Management ──
  const [clients, setClients] = useState<ClientLocal[]>([]);
  const [activeClient, setActiveClient] = useState<ClientLocal | null>(null);
  const [clientForm, setClientForm] = useState(EMPTY_CLIENT_FORM);
  const [showClientForm, setShowClientForm] = useState(false);
  const [editingClient, setEditingClient] = useState<number | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientView, setClientView] = useState<"list" | "detail">("list");

  // ── Analysis ──
  const [reportText, setReportText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [flagged, setFlagged] = useState<FlaggedItem[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [analysisErr, setAnalysisErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Letter Gen ──
  const [disputeTarget, setDisputeTarget] = useState("bureau");
  const [selBureau, setSelBureau] = useState("");
  const [furnisher, setFurnisher] = useState<Furnisher>({
    name: "",
    address: "",
  });
  const [generating, setGenerating] = useState(false);
  const [letters, setLetters] = useState<LetterResult[]>([]);
  const [genProg, setGenProg] = useState({ c: 0, t: 0 });
  const [genErr, setGenErr] = useState<string | null>(null);
  const [wizStep, setWizStep] = useState(0);
  const [copied, setCopied] = useState<number | "all" | null>(null);
  const [viewLetter, setViewLetter] = useState<number | null>(null);

  // ── Disputes ──
  const [disputes, setDisputes] = useState<DisputeLocal[]>([]);

  // ── Initial load ──
  useEffect(() => {
    (async () => {
      try {
        const [cls, disp] = await Promise.all([
          actor!.getAllClients(),
          actor!.getAllDisputes(),
        ]);
        setClients(
          cls.map((c) => ({
            ...c,
            id: Number(c.id),
            disputeCount: Number(c.disputeCount),
            resolvedCount: Number(c.resolvedCount),
          })),
        );
        setDisputes(
          disp.map((d) => ({
            ...d,
            id: Number(d.id),
            clientId: Number(d.clientId),
            daysLeft: Number(d.daysLeft),
          })),
        );
      } catch (e) {
        console.error("Load error", e);
        toast.error("Failed to load data from backend.");
      } finally {
        setDataLoading(false);
      }
    })();
  }, [actor]);

  // ── Client CRUD ──
  const addClient = async () => {
    if (!clientForm.fullName.trim()) return;
    const now = new Date().toISOString();
    const newC = {
      id: 0n,
      fullName: clientForm.fullName,
      email: clientForm.email,
      phone: clientForm.phone,
      address: clientForm.address,
      cityStateZip: clientForm.cityStateZip,
      ssnLast4: clientForm.ssnLast4,
      notes: clientForm.notes,
      createdAt: now,
      disputeCount: 0n,
      resolvedCount: 0n,
      status: "active",
    };
    try {
      const realId = await actor!.addClient(newC);
      const local: ClientLocal = {
        ...clientForm,
        id: Number(realId),
        createdAt: now,
        disputeCount: 0,
        resolvedCount: 0,
        status: "active",
      };
      setClients((p) => [local, ...p]);
      setClientForm(EMPTY_CLIENT_FORM);
      setShowClientForm(false);
      toast.success("Client added.");
    } catch (e) {
      toast.error("Failed to add client.");
      console.error(e);
    }
  };

  const updateClient = async () => {
    if (!editingClient || !clientForm.fullName.trim()) return;
    const existing = clients.find((c) => c.id === editingClient);
    if (!existing) return;
    const updated = { ...existing, ...clientForm };
    try {
      await actor!.updateClient({
        ...updated,
        id: BigInt(updated.id),
        disputeCount: BigInt(updated.disputeCount),
        resolvedCount: BigInt(updated.resolvedCount),
      });
      setClients((p) => p.map((c) => (c.id === editingClient ? updated : c)));
      setEditingClient(null);
      setClientForm(EMPTY_CLIENT_FORM);
      setShowClientForm(false);
      toast.success("Client updated.");
    } catch (e) {
      toast.error("Failed to update client.");
      console.error(e);
    }
  };

  const deleteClient = async (id: number) => {
    try {
      await actor!.deleteClient(BigInt(id));
      setClients((p) => p.filter((c) => c.id !== id));
      if (activeClient?.id === id) setActiveClient(null);
      toast.success("Client deleted.");
    } catch (e) {
      toast.error("Failed to delete client.");
      console.error(e);
    }
  };

  const startEdit = (c: ClientLocal) => {
    setEditingClient(c.id);
    setClientForm({
      fullName: c.fullName,
      email: c.email || "",
      phone: c.phone || "",
      address: c.address || "",
      cityStateZip: c.cityStateZip || "",
      ssnLast4: c.ssnLast4 || "",
      notes: c.notes || "",
    });
    setShowClientForm(true);
  };

  const selectClient = (c: ClientLocal) => {
    setActiveClient(c);
    setClientView("detail");
  };

  const startAnalysisForClient = (c: ClientLocal) => {
    setActiveClient(c);
    setTab("analyze");
    setWizStep(0);
    setReportText("");
    setFlagged(null);
    setSelected(new Set());
    setLetters([]);
    setAnalysisErr(null);
    setGenErr(null);
  };

  const filteredClients = clients.filter(
    (c) =>
      c.fullName.toLowerCase().includes(clientSearch.toLowerCase()) ||
      (c.email || "").toLowerCase().includes(clientSearch.toLowerCase()),
  );

  const clientDisputes = (cid: number) =>
    disputes.filter((d) => d.clientId === cid);

  // ── Analysis ──
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setReportText(ev.target?.result as string);
    reader.readAsText(f);
  };

  const handleAnalyze = async () => {
    if (!reportText.trim() || reportText.length < 50) {
      setAnalysisErr("Paste or upload credit report text.");
      return;
    }
    setAnalyzing(true);
    setAnalysisErr(null);
    setFlagged(null);
    try {
      const items = await analyzeReport(HARDCODED_KEY, reportText.trim());
      setFlagged(items);
      setSelected(new Set(items.map((_, i) => i)));
      setWizStep(1);
    } catch (e: unknown) {
      setAnalysisErr((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleItem = (i: number) =>
    setSelected((p) => {
      const n = new Set(p);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  // ── Batch Generate ──
  const handleBatch = async () => {
    const items = [...selected].map((i) => flagged![i]);
    if (!items.length) return;
    const ci =
      activeClient ||
      ({
        fullName: "[NAME]",
        address: "[ADDRESS]",
        cityStateZip: "[CITY STATE ZIP]",
        ssnLast4: "",
      } as ClientLocal);
    setGenerating(true);
    setGenErr(null);
    setLetters([]);
    setGenProg({ c: 0, t: items.length });
    setWizStep(4);
    const out: LetterResult[] = [];
    for (let i = 0; i < items.length; i++) {
      setGenProg({ c: i + 1, t: items.length });
      try {
        const t = await genLetter(
          HARDCODED_KEY,
          ci,
          items[i],
          selBureau,
          disputeTarget,
          furnisher,
        );
        out.push({ item: items[i], text: t, error: null });
      } catch (e: unknown) {
        out.push({ item: items[i], text: null, error: (e as Error).message });
      }
    }
    setLetters(out);
    setGenerating(false);
    setWizStep(5);
  };

  const saveAllTracker = async () => {
    const bd = BUREAUS.find((b) => b.id === selBureau);
    const today = new Date().toISOString().split("T")[0];
    const toAdd = letters.filter((l) => l.text);
    const newDisputes: DisputeLocal[] = [];
    for (const l of toAdd) {
      const d = {
        id: 0n,
        clientId: BigInt(activeClient?.id || 0),
        clientName: activeClient?.fullName || "Manual",
        account: l.item.account,
        bureau:
          disputeTarget === "bureau"
            ? bd?.name || "Bureau"
            : furnisher.name || "Furnisher",
        reason: l.item.issueLabel,
        status: Status.pending,
        date: today,
        daysLeft: 30n,
      };
      try {
        const realId = await actor!.addDispute(d);
        newDisputes.push({
          id: Number(realId),
          clientId: Number(d.clientId),
          clientName: d.clientName,
          account: d.account,
          bureau: d.bureau,
          reason: d.reason,
          status: Status.pending,
          date: today,
          daysLeft: 30,
        });
      } catch (e) {
        console.error("addDispute error", e);
        toast.error(`Failed to save dispute for ${l.item.account}`);
      }
    }
    if (newDisputes.length) {
      setDisputes((p) => [...p, ...newDisputes]);
      if (activeClient) {
        setClients((p) =>
          p.map((c) =>
            c.id === activeClient.id
              ? { ...c, disputeCount: c.disputeCount + newDisputes.length }
              : c,
          ),
        );
      }
      toast.success(`${newDisputes.length} dispute(s) saved to tracker.`);
      setTab("tracker");
    }
  };

  const updateDisputeStatus = async (id: number, newStatus: Status) => {
    try {
      await actor!.updateDisputeStatus(BigInt(id), newStatus);
      setDisputes((p) =>
        p.map((d) => (d.id === id ? { ...d, status: newStatus } : d)),
      );
    } catch (e) {
      toast.error("Failed to update status.");
      console.error(e);
    }
  };

  const copyLtr = (i: number) => {
    const text = letters[i].text;
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(i);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(console.error);
  };

  const copyAll = () => {
    const a = letters
      .filter((l) => l.text)
      .map(
        (l, i) =>
          `${"=".repeat(50)}\nLETTER ${i + 1}: ${l.item.account}\n${"=".repeat(50)}\n\n${l.text}`,
      )
      .join("\n\n\n");
    navigator.clipboard
      .writeText(a)
      .then(() => {
        setCopied("all");
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(console.error);
  };

  const resetWiz = () => {
    setWizStep(0);
    setReportText("");
    setFlagged(null);
    setSelected(new Set());
    setLetters([]);
    setAnalysisErr(null);
    setGenErr(null);
  };

  const toggle = (i: number) =>
    setChecks((p) => {
      const n = [...p];
      n[i] = !n[i];
      return n;
    });

  const done = checks.filter(Boolean).length;
  const setCF = (k: string, v: string) =>
    setClientForm((p) => ({ ...p, [k]: v }));

  if (dataLoading) {
    return (
      <>
        <style>{CSS}</style>
        <div
          className="shell"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto 16px" }} />
            <div className="gen-text">Loading your data from ICP...</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="shell">
        <header className="hdr">
          <div className="hdr-in">
            <div className="logo-g">
              <div className="logo-m">C</div>
              <div className="logo-t">
                Credit<em>Clear</em>
              </div>
            </div>
            <nav className="tabs">
              {(
                [
                  ["clients", "Clients"],
                  ["analyze", "Analyze"],
                  ["tracker", "Tracker"],
                  ["fcra", "FCRA"],
                  ["croa", "CROA"],
                  ["checklist", "Checklist"],
                ] as [string, string][]
              ).map(([id, lb]) => (
                <button
                  type="button"
                  key={id}
                  className={`tab${tab === id ? " on" : ""}`}
                  onClick={() => setTab(id)}
                  data-ocid={`nav.${id}.tab`}
                >
                  {lb}
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="btn btn-s"
              style={{ fontSize: 12, padding: "7px 14px", marginLeft: 8 }}
              onClick={logout}
              data-ocid="nav.logout.button"
            >
              Logout
            </button>
          </div>
        </header>

        <main className="main">
          {/* ══════ CLIENTS ══════ */}
          {tab === "clients" && clientView === "list" && (
            <div className="fu">
              <div className="sh">
                <div>
                  <h2>Client List</h2>
                  <p>
                    {clients.length} client{clients.length !== 1 ? "s" : ""}{" "}
                    managed
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-g"
                  onClick={() => {
                    setShowClientForm(true);
                    setEditingClient(null);
                    setClientForm(EMPTY_CLIENT_FORM);
                  }}
                  data-ocid="clients.open_modal_button"
                >
                  + Add Client
                </button>
              </div>

              <div className="search-bar">
                <input
                  className="fi"
                  placeholder="🔍 Search clients by name or email..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  data-ocid="clients.search_input"
                />
              </div>

              {showClientForm && (
                <div
                  className="card client-form-card fu"
                  data-ocid="clients.modal"
                >
                  <h3 className="step-title">
                    {editingClient ? "Edit Client" : "New Client"}
                  </h3>
                  <div className="fgrid">
                    <div className="fg">
                      <span className="fl">Full Name *</span>
                      <input
                        className="fi"
                        placeholder="John Smith"
                        value={clientForm.fullName}
                        onChange={(e) => setCF("fullName", e.target.value)}
                        data-ocid="clients.input"
                      />
                    </div>
                    <div className="fg">
                      <span className="fl">Email</span>
                      <input
                        className="fi"
                        placeholder="john@email.com"
                        value={clientForm.email}
                        onChange={(e) => setCF("email", e.target.value)}
                      />
                    </div>
                    <div className="fg">
                      <span className="fl">Phone</span>
                      <input
                        className="fi"
                        placeholder="(555) 123-4567"
                        value={clientForm.phone}
                        onChange={(e) => setCF("phone", e.target.value)}
                      />
                    </div>
                    <div className="fg">
                      <span className="fl">Last 4 SSN</span>
                      <input
                        className="fi"
                        placeholder="1234"
                        maxLength={4}
                        value={clientForm.ssnLast4}
                        onChange={(e) =>
                          setCF("ssnLast4", e.target.value.replace(/\D/g, ""))
                        }
                      />
                    </div>
                    <div className="fg">
                      <span className="fl">Address</span>
                      <input
                        className="fi"
                        placeholder="123 Main St"
                        value={clientForm.address}
                        onChange={(e) => setCF("address", e.target.value)}
                      />
                    </div>
                    <div className="fg">
                      <span className="fl">City, State, ZIP</span>
                      <input
                        className="fi"
                        placeholder="Houston, TX 77001"
                        value={clientForm.cityStateZip}
                        onChange={(e) => setCF("cityStateZip", e.target.value)}
                      />
                    </div>
                    <div className="fg full">
                      <span className="fl">Notes</span>
                      <textarea
                        className="ft"
                        placeholder="Internal notes..."
                        value={clientForm.notes}
                        onChange={(e) => setCF("notes", e.target.value)}
                        style={{ minHeight: 60 }}
                      />
                    </div>
                  </div>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn-s"
                      onClick={() => {
                        setShowClientForm(false);
                        setEditingClient(null);
                      }}
                      data-ocid="clients.cancel_button"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-g"
                      disabled={!clientForm.fullName.trim()}
                      onClick={editingClient ? updateClient : addClient}
                      data-ocid="clients.submit_button"
                    >
                      {editingClient ? "Update" : "Add Client"}
                    </button>
                  </div>
                </div>
              )}

              {filteredClients.length === 0 ? (
                <div className="empty" data-ocid="clients.empty_state">
                  <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>
                    👥
                  </div>
                  <p>
                    {clients.length
                      ? "No matching clients"
                      : "No clients yet — add your first client above"}
                  </p>
                </div>
              ) : (
                <div className="client-grid" data-ocid="clients.list">
                  {filteredClients.map((c, idx) => {
                    const cd = clientDisputes(c.id);
                    const active = cd.filter(
                      (d) => d.status !== Status.resolved,
                    ).length;
                    const resolved = cd.filter(
                      (d) => d.status === Status.resolved,
                    ).length;
                    return (
                      <div
                        key={c.id}
                        className="card client-card"
                        onClick={() => selectClient(c)}
                        data-ocid={`clients.item.${idx + 1}`}
                      >
                        <div className="cc-top">
                          <div className="cc-avatar">
                            {c.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div className="cc-status-dot" />
                        </div>
                        <div className="cc-name">{c.fullName}</div>
                        {c.email && <div className="cc-email">{c.email}</div>}
                        <div className="cc-stats-row">
                          <div className="cc-stat">
                            <span className="cc-stat-n">{active}</span>
                            <span className="cc-stat-l">Active</span>
                          </div>
                          <div className="cc-stat">
                            <span className="cc-stat-n cc-em">{resolved}</span>
                            <span className="cc-stat-l">Resolved</span>
                          </div>
                          <div className="cc-stat">
                            <span className="cc-stat-n">{cd.length}</span>
                            <span className="cc-stat-l">Total</span>
                          </div>
                        </div>
                        <div
                          className="cc-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="btn-icon"
                            title="Analyze Report"
                            onClick={() => startAnalysisForClient(c)}
                            data-ocid={`clients.edit_button.${idx + 1}`}
                          >
                            🔍
                          </button>
                          <button
                            type="button"
                            className="btn-icon"
                            title="Edit"
                            onClick={() => startEdit(c)}
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className="btn-icon"
                            title="Delete"
                            onClick={() => {
                              if (confirm(`Delete ${c.fullName}?`))
                                deleteClient(c.id);
                            }}
                            data-ocid={`clients.delete_button.${idx + 1}`}
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* CLIENT DETAIL */}
          {tab === "clients" && clientView === "detail" && activeClient && (
            <div className="fu">
              <button
                type="button"
                className="btn btn-s"
                style={{ marginBottom: 16 }}
                onClick={() => setClientView("list")}
                data-ocid="clients.secondary_button"
              >
                ← All Clients
              </button>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="detail-header">
                  <div className="cc-avatar lg">
                    {activeClient.fullName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2
                      style={{
                        fontFamily: "'Playfair Display',serif",
                        fontSize: 24,
                      }}
                    >
                      {activeClient.fullName}
                    </h2>
                    <div className="detail-meta">
                      {activeClient.email && <span>{activeClient.email}</span>}
                      {activeClient.phone && (
                        <span>• {activeClient.phone}</span>
                      )}
                      {activeClient.cityStateZip && (
                        <span>• {activeClient.cityStateZip}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-g"
                    onClick={() => startAnalysisForClient(activeClient)}
                    data-ocid="clients.primary_button"
                  >
                    🔍 Analyze Report
                  </button>
                </div>
                {activeClient.notes && (
                  <div className="detail-notes">
                    <strong>Notes:</strong> {activeClient.notes}
                  </div>
                )}
              </div>

              <h3 className="step-title" style={{ marginBottom: 12 }}>
                Dispute History
              </h3>
              {clientDisputes(activeClient.id).length ? (
                <table className="ttable">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Target</th>
                      <th>Reason</th>
                      <th>Filed</th>
                      <th>Status</th>
                      <th>Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientDisputes(activeClient.id)
                      .slice()
                      .reverse()
                      .map((d) => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 700 }}>{d.account}</td>
                          <td>{d.bureau}</td>
                          <td>{d.reason}</td>
                          <td className="mono-sm">{d.date}</td>
                          <td>
                            <span className={`badge b-${d.status}`}>
                              {d.status.charAt(0).toUpperCase() +
                                d.status.slice(1)}
                            </span>
                          </td>
                          <td>
                            {d.status === Status.resolved ? (
                              <span className="c-em">✓</span>
                            ) : (
                              `${d.daysLeft}d`
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <div
                  className="card"
                  style={{
                    textAlign: "center",
                    padding: 30,
                    color: "var(--t3)",
                  }}
                >
                  No disputes yet for this client
                </div>
              )}
            </div>
          )}

          {/* ══════ ANALYZE ══════ */}
          {tab === "analyze" && (
            <div className="fu">
              <div className="sh">
                <div>
                  <h2>Analyze Report</h2>
                  <p>
                    {activeClient
                      ? `For: ${activeClient.fullName}`
                      : "Select a client first, or analyze standalone"}{" "}
                    — Venice AI flags disputable items
                  </p>
                </div>
                {!activeClient && (
                  <button
                    type="button"
                    className="btn btn-s"
                    onClick={() => setTab("clients")}
                  >
                    Select Client
                  </button>
                )}
              </div>

              <div className="wiz-steps">
                {["Input", "Review", "Target", "Generating", "Letters"].map(
                  (s, i) => (
                    <div
                      key={s}
                      className={`wiz-s${wizStep === i ? " on" : wizStep > i ? " done" : ""}`}
                    >
                      <span className="wiz-n">{i + 1}</span>
                      <span className="wiz-l">{s}</span>
                    </div>
                  ),
                )}
              </div>

              {analysisErr && (
                <div className="err-box" data-ocid="analyze.error_state">
                  ⚠️ {analysisErr}
                </div>
              )}
              {genErr && <div className="err-box">⚠️ {genErr}</div>}

              {/* Step 0: Input */}
              {wizStep === 0 && (
                <div className="card fu">
                  <h3 className="step-title">Step 1 — Input Credit Report</h3>
                  <p className="step-desc">
                    Paste the full text or upload a file. Venice AI analyzes
                    against FCRA provisions.
                  </p>
                  <div className="input-modes">
                    <div
                      className="upload-zone"
                      onClick={() => fileRef.current?.click()}
                      data-ocid="analyze.upload_button"
                    >
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".txt,.pdf,.csv,.html"
                        style={{ display: "none" }}
                        onChange={handleFile}
                      />
                      <div
                        style={{ fontSize: 36, marginBottom: 8, opacity: 0.6 }}
                      >
                        📄
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          marginBottom: 4,
                        }}
                      >
                        Upload File
                      </div>
                      <div style={{ fontSize: 11, color: "var(--t3)" }}>
                        PDF, TXT, CSV, HTML
                      </div>
                    </div>
                    <div className="or-div">
                      <span>OR</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <span className="fl">Paste Report Text</span>
                      <textarea
                        className="ft report-ta"
                        placeholder="Paste your full credit report text here..."
                        value={reportText}
                        onChange={(e) => setReportText(e.target.value)}
                        data-ocid="analyze.textarea"
                      />
                    </div>
                  </div>
                  {reportText && (
                    <div className="text-stats">
                      <span>{reportText.length.toLocaleString()} chars</span>
                      <span>•</span>
                      <span>
                        ~{Math.ceil(reportText.split(/\s+/).length)} words
                      </span>
                    </div>
                  )}
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn-g"
                      disabled={!reportText.trim() || analyzing}
                      onClick={handleAnalyze}
                      data-ocid="analyze.primary_button"
                    >
                      {analyzing ? "Analyzing..." : "🔍 Analyze with Venice AI"}
                    </button>
                  </div>
                  {analyzing && (
                    <div
                      className="loading-box"
                      data-ocid="analyze.loading_state"
                    >
                      <div className="spinner" />
                      <div className="gen-text">
                        Scanning report against FCRA...
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 1: Flags */}
              {wizStep === 1 && flagged && (
                <div className="fu">
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="flags-hdr">
                      <div>
                        <h3 className="step-title" style={{ margin: 0 }}>
                          Found {flagged.length} disputable item
                          {flagged.length !== 1 ? "s" : ""}
                        </h3>
                        <p className="step-desc" style={{ margin: "4px 0 0" }}>
                          Select which to dispute
                        </p>
                      </div>
                      <div className="flags-act">
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() =>
                            setSelected(new Set(flagged.map((_, i) => i)))
                          }
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() => setSelected(new Set())}
                        >
                          None
                        </button>
                      </div>
                    </div>
                  </div>
                  {flagged.length === 0 ? (
                    <div
                      className="card"
                      style={{ textAlign: "center", padding: 40 }}
                    >
                      <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                      <p style={{ color: "var(--t2)" }}>Report looks clean!</p>
                      <button
                        type="button"
                        className="btn btn-s"
                        style={{ marginTop: 16 }}
                        onClick={resetWiz}
                      >
                        ← Try Another
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flags-grid" data-ocid="analyze.list">
                        {flagged.map((it, idx) => {
                          const sv = SEV[it.severity] || SEV.medium;
                          const ic = ICONS[it.issue] || "⚠️";
                          const sel = selected.has(idx);
                          return (
                            <div
                              key={`${it.account}-${idx}`}
                              className={`flag-card${sel ? " selected" : ""}`}
                              onClick={() => toggleItem(idx)}
                              data-ocid={`analyze.item.${idx + 1}`}
                            >
                              <div className="flag-top">
                                <div className={`flag-chk${sel ? " on" : ""}`}>
                                  {sel ? "✓" : ""}
                                </div>
                                <span
                                  className="flag-sev"
                                  style={{
                                    background: sv.bg,
                                    color: sv.c,
                                    borderColor: sv.b,
                                  }}
                                >
                                  {sv.l}
                                </span>
                              </div>
                              <div style={{ fontSize: 24, marginBottom: 6 }}>
                                {ic}
                              </div>
                              <div className="flag-acct">{it.account}</div>
                              {it.accountNumber && (
                                <div className="flag-num">
                                  #{it.accountNumber}
                                </div>
                              )}
                              <div className="flag-iss">{it.issueLabel}</div>
                              <div className="flag-exp">{it.explanation}</div>
                              <div className="flag-fcra">{it.fcraSections}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn-s"
                          onClick={() => {
                            setWizStep(0);
                            setFlagged(null);
                          }}
                        >
                          ← Re-analyze
                        </button>
                        <button
                          type="button"
                          className="btn btn-g"
                          disabled={!selected.size}
                          onClick={() => setWizStep(2)}
                          data-ocid="analyze.primary_button"
                        >
                          Continue with {selected.size} →
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Step 2: Target */}
              {wizStep === 2 && (
                <div className="card fu">
                  <h3 className="step-title">Step 3 — Dispute Target</h3>
                  <p className="step-desc">Who should the letters go to?</p>
                  <div className="target-row">
                    <div
                      className={`tcard${disputeTarget === "bureau" ? " on" : ""}`}
                      onClick={() => setDisputeTarget("bureau")}
                    >
                      <div className="ti">🏛</div>
                      <div className="tl">Credit Bureau</div>
                      <div className="td">§611</div>
                    </div>
                    <div
                      className={`tcard${disputeTarget === "furnisher" ? " on" : ""}`}
                      onClick={() => setDisputeTarget("furnisher")}
                    >
                      <div className="ti">🏦</div>
                      <div className="tl">Furnisher</div>
                      <div className="td">§623(b)</div>
                    </div>
                  </div>
                  {disputeTarget === "bureau" && (
                    <>
                      <span
                        className="fl"
                        style={{ marginBottom: 10, display: "block" }}
                      >
                        Select Bureau
                      </span>
                      <div className="bureau-row">
                        {BUREAUS.map((b) => (
                          <div
                            key={b.id}
                            className={`bchip${selBureau === b.id ? " on" : ""}`}
                            onClick={() => setSelBureau(b.id)}
                          >
                            <div className="bn">{b.name}</div>
                            <div className="ba">{b.address}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {disputeTarget === "furnisher" && (
                    <div className="fgrid">
                      <div className="fg">
                        <span className="fl">Furnisher Name</span>
                        <input
                          className="fi"
                          value={furnisher.name}
                          onChange={(e) =>
                            setFurnisher((p) => ({
                              ...p,
                              name: e.target.value,
                            }))
                          }
                          placeholder="Capital One, N.A."
                        />
                      </div>
                      <div className="fg">
                        <span className="fl">Address</span>
                        <input
                          className="fi"
                          value={furnisher.address}
                          onChange={(e) =>
                            setFurnisher((p) => ({
                              ...p,
                              address: e.target.value,
                            }))
                          }
                          placeholder="P.O. Box ..."
                        />
                      </div>
                    </div>
                  )}
                  <div className="summary-box">
                    <div className="sum-t">Summary</div>
                    <div className="sum-r">
                      <span>Client:</span>
                      <strong>{activeClient?.fullName || "Standalone"}</strong>
                    </div>
                    <div className="sum-r">
                      <span>Items:</span>
                      <strong>{selected.size}</strong>
                    </div>
                    <div className="sum-r">
                      <span>Target:</span>
                      <strong>
                        {disputeTarget === "bureau"
                          ? BUREAUS.find((b) => b.id === selBureau)?.name ||
                            "Select"
                          : furnisher.name || "Enter"}
                      </strong>
                    </div>
                  </div>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn-s"
                      onClick={() => setWizStep(1)}
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      className="btn btn-g"
                      disabled={
                        disputeTarget === "bureau"
                          ? !selBureau
                          : !furnisher.name.trim()
                      }
                      onClick={handleBatch}
                      data-ocid="analyze.primary_button"
                    >
                      ⚡ Generate {selected.size} Letter
                      {selected.size !== 1 ? "s" : ""}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: Generating */}
              {wizStep === 4 && generating && (
                <div
                  className="card fu"
                  style={{ textAlign: "center", padding: "60px 20px" }}
                  data-ocid="analyze.loading_state"
                >
                  <div className="spinner" />
                  <div className="gen-text">
                    Letter {genProg.c} of {genProg.t}...
                  </div>
                  <div className="gen-sub">
                    Citing FCRA/CROA for each dispute
                  </div>
                  <div className="prog-bar">
                    <div
                      className="prog-fill"
                      style={{ width: `${(genProg.c / genProg.t) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Step 5: Letters */}
              {wizStep === 5 && letters.length > 0 && (
                <div className="fu">
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="flags-hdr">
                      <div>
                        <h3 className="step-title" style={{ margin: 0 }}>
                          {letters.filter((l) => l.text).length} Letter
                          {letters.filter((l) => l.text).length !== 1
                            ? "s"
                            : ""}{" "}
                          Ready
                        </h3>
                        <p className="step-desc" style={{ margin: "4px 0 0" }}>
                          Review, copy, print &amp; send certified
                        </p>
                      </div>
                      <div className="flags-act">
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={copyAll}
                        >
                          {copied === "all" ? "✓ All Copied!" : "Copy All"}
                        </button>
                        <button
                          type="button"
                          className="btn-sm btn-g-sm"
                          onClick={saveAllTracker}
                          data-ocid="analyze.save_button"
                        >
                          ✓ Save to Tracker
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="letters-list" data-ocid="analyze.list">
                    {letters.map((l, i) => (
                      <div
                        key={`letter-${i}`}
                        className="card ltr-card"
                        data-ocid={`analyze.item.${i + 1}`}
                      >
                        <div className="lc-hdr">
                          <div>
                            <div className="lc-n">Letter {i + 1}</div>
                            <div className="lc-a">{l.item.account}</div>
                            <div className="lc-i">
                              {l.item.issueLabel} • {l.item.fcraSections}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            {l.text && (
                              <button
                                type="button"
                                className="btn-sm"
                                onClick={() => copyLtr(i)}
                              >
                                {copied === i ? "✓" : "Copy"}
                              </button>
                            )}
                            {l.text && (
                              <button
                                type="button"
                                className="btn-sm"
                                onClick={() =>
                                  setViewLetter(viewLetter === i ? null : i)
                                }
                              >
                                {viewLetter === i ? "Collapse" : "View"}
                              </button>
                            )}
                          </div>
                        </div>
                        {l.error && (
                          <div
                            className="err-box"
                            style={{ margin: "12px 0 0" }}
                          >
                            {l.error}
                          </div>
                        )}
                        {l.text && viewLetter === i && (
                          <div className="letter">{l.text}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="btn-row" style={{ marginTop: 16 }}>
                    <button
                      type="button"
                      className="btn btn-s"
                      onClick={resetWiz}
                    >
                      ← New Analysis
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════ TRACKER ══════ */}
          {tab === "tracker" && (
            <div className="fu">
              <div className="sh">
                <div>
                  <h2>Dispute Tracker</h2>
                  <p>
                    {disputes.length} total • 30-day deadline per FCRA §611(a)
                  </p>
                </div>
              </div>
              {disputes.length ? (
                <table className="ttable" data-ocid="tracker.table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Account</th>
                      <th>Target</th>
                      <th>Reason</th>
                      <th>Filed</th>
                      <th>Status</th>
                      <th>Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...disputes].reverse().map((d, idx) => (
                      <tr key={d.id} data-ocid={`tracker.row.${idx + 1}`}>
                        <td>{d.clientName || "—"}</td>
                        <td style={{ fontWeight: 700 }}>{d.account}</td>
                        <td>{d.bureau}</td>
                        <td>{d.reason}</td>
                        <td className="mono-sm">{d.date}</td>
                        <td>
                          <select
                            className="status-sel"
                            value={d.status}
                            onChange={(e) =>
                              updateDisputeStatus(
                                d.id,
                                e.target.value as Status,
                              )
                            }
                            data-ocid={`tracker.select.${idx + 1}`}
                          >
                            <option value={Status.pending}>Pending</option>
                            <option value={Status.investigating}>
                              Investigating
                            </option>
                            <option value={Status.resolved}>Resolved</option>
                            <option value={Status.rejected}>Rejected</option>
                          </select>
                        </td>
                        <td>
                          {d.status === Status.resolved ? (
                            <span className="c-em">✓</span>
                          ) : (
                            <span
                              style={{
                                color:
                                  d.daysLeft < 10 ? "var(--red)" : "var(--t1)",
                              }}
                            >
                              {d.daysLeft}d
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty" data-ocid="tracker.empty_state">
                  <p>No disputes tracked yet</p>
                </div>
              )}
            </div>
          )}

          {/* ══════ FCRA ══════ */}
          {tab === "fcra" && (
            <div className="fu">
              <div className="sh">
                <div>
                  <h2>FCRA Reference</h2>
                  <p>15 U.S.C. §1681</p>
                </div>
              </div>
              <div className="law-grid">
                {FCRA_REF.map((l) => (
                  <div key={l.s} className="card law">
                    <div className="ls">FCRA {l.s}</div>
                    <div className="lu">{l.u}</div>
                    <div className="lt">{l.t}</div>
                    <div className="lsm">{l.sum}</div>
                    <div className="luse">{l.use}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════ CROA ══════ */}
          {tab === "croa" && (
            <div className="fu">
              <div className="sh">
                <div>
                  <h2>CROA Reference</h2>
                  <p>15 U.S.C. §1679</p>
                </div>
              </div>
              <div className="law-grid">
                {CROA_REF.map((l) => (
                  <div key={l.s} className="card law">
                    <div className="ls">CROA {l.s}</div>
                    <div className="lu">15 U.S.C. {l.s}</div>
                    <div className="lt">{l.t}</div>
                    <div className="lsm">{l.sum}</div>
                    <div className="luse">{l.use}</div>
                  </div>
                ))}
              </div>
              <div className="card callout" style={{ marginTop: 20 }}>
                <span style={{ fontSize: 28 }}>⚖️</span>
                <div>
                  <h4>Your Right to Self-Repair</h4>
                  <p>
                    Under CROA §1679c, you can dispute directly — for free. No
                    upfront fees (§1679b). 3-day cancel right (§1679e).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ══════ CHECKLIST ══════ */}
          {tab === "checklist" && (
            <div className="fu">
              <div className="sh">
                <div>
                  <h2>Checklist</h2>
                  <p>FCRA dispute process</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="lbl">Progress</div>
                  <div
                    style={{
                      fontSize: 22,
                      fontFamily: "'Playfair Display',serif",
                      color: "var(--gold)",
                    }}
                  >
                    {done}/{CHECKLIST.length}
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="prog-bar" style={{ marginBottom: 20 }}>
                  <div
                    className="prog-fill"
                    style={{ width: `${(done / CHECKLIST.length) * 100}%` }}
                  />
                </div>
                {CHECKLIST.map((it, i) => (
                  <div
                    key={it}
                    className="clitem"
                    onClick={() => toggle(i)}
                    data-ocid={`checklist.item.${i + 1}`}
                  >
                    <div className={`clbox${checks[i] ? " ck" : ""}`}>
                      {checks[i] ? "✓" : ""}
                    </div>
                    <div className={`cltext${checks[i] ? " done" : ""}`}>
                      <strong
                        style={{ color: checks[i] ? "var(--t3)" : "var(--t1)" }}
                      >
                        Step {i + 1}.
                      </strong>{" "}
                      {it}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <footer
            style={{
              textAlign: "center",
              marginTop: 40,
              padding: "20px 0",
              fontSize: 12,
              color: "var(--t3)",
            }}
          >
            © {new Date().getFullYear()}. Built with ❤️ using{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--gold)", textDecoration: "none" }}
            >
              caffeine.ai
            </a>
          </footer>
        </main>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=Manrope:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
:root{--bg-0:#06090f;--bg-1:#0c1220;--bg-2:#131d30;--bg-3:#1a2540;--t1:#f0f2f8;--t2:#a0aec0;--t3:#5a6a85;--gold:#c9a227;--gold-l:#e8c84a;--gold-d:rgba(201,162,39,.12);--emerald:#2dd4a8;--red:#ef6461;--blue:#5b9cf6;--border:rgba(160,174,192,.07);--border-a:rgba(201,162,39,.25);--r:10px;--r2:16px}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Manrope',sans-serif;background:var(--bg-0);color:var(--t1);min-height:100vh;-webkit-font-smoothing:antialiased}
.shell{min-height:100vh;background:linear-gradient(175deg,var(--bg-0),var(--bg-1) 50%,#080c16);position:relative}
.shell::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 70% 40% at 20% -10%,rgba(201,162,39,.04),transparent),radial-gradient(ellipse 50% 30% at 85% 110%,rgba(45,212,168,.025),transparent);pointer-events:none}
.hdr{position:sticky;top:0;z-index:200;backdrop-filter:blur(24px) saturate(180%);background:rgba(6,9,15,.75);border-bottom:1px solid var(--border)}
.hdr-in{max-width:1440px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:64px;padding:0 24px}
.logo-g{display:flex;align-items:center;gap:10px}.logo-m{width:36px;height:36px;background:linear-gradient(135deg,var(--gold),var(--gold-l));border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:800;font-size:17px;color:var(--bg-0);box-shadow:0 3px 14px rgba(201,162,39,.3)}
.logo-t{font-family:'Playfair Display',serif;font-size:20px;font-weight:700;letter-spacing:-.5px}.logo-t em{color:var(--gold);font-style:normal}
.tabs{display:flex;gap:2px;background:rgba(26,37,64,.5);padding:3px;border-radius:var(--r)}.tab{padding:8px 16px;border-radius:7px;border:none;background:transparent;color:var(--t3);font-family:'Manrope',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s;white-space:nowrap}.tab:hover{color:var(--t2)}.tab.on{background:var(--bg-3);color:var(--gold);box-shadow:0 2px 6px rgba(0,0,0,.25)}
.main{max-width:1440px;margin:0 auto;padding:24px;position:relative;z-index:1}
.card{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r2);padding:24px;transition:all .25s}.card:hover{border-color:var(--border-a)}
.api-bar{display:flex;gap:10px;align-items:center;margin-bottom:20px;padding:14px 18px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r2);flex-wrap:wrap}
.api-bar .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}.api-bar .dot.on{background:var(--emerald);box-shadow:0 0 8px rgba(45,212,168,.5)}.api-bar .dot.off{background:var(--red);box-shadow:0 0 8px rgba(239,100,97,.4)}
.api-bar input{flex:1;min-width:180px;background:var(--bg-1);border:1px solid var(--border);border-radius:7px;padding:9px 12px;color:var(--t1);font-family:'IBM Plex Mono',monospace;font-size:12px;outline:none}.api-bar input:focus{border-color:var(--gold)}.api-bar input::placeholder{color:var(--t3)}
.api-label{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;white-space:nowrap}.api-status{font-size:11px;color:var(--t3);white-space:nowrap}
.sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px}.sh h2{font-family:'Playfair Display',serif;font-size:24px;font-weight:700}.sh p{font-size:13px;color:var(--t3);margin-top:2px}
.step-title{font-family:'Playfair Display',serif;font-size:19px;margin-bottom:4px}.step-desc{font-size:13px;color:var(--t3);margin-bottom:18px}
.fg{display:flex;flex-direction:column;gap:4px}.fg.full{grid-column:1/-1}.fl{font-size:11px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:2px}
.fi,.ft{background:var(--bg-1);border:1px solid var(--border);border-radius:7px;padding:10px 12px;color:var(--t1);font-family:'Manrope',sans-serif;font-size:13px;outline:none;transition:border .2s;width:100%}.fi:focus,.ft:focus{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-d)}.fi::placeholder,.ft::placeholder{color:var(--t3)}.ft{resize:vertical;min-height:80px;font-size:12px}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
.btn{padding:11px 22px;border-radius:7px;border:none;font-family:'Manrope',sans-serif;font-size:13px;font-weight:700;cursor:pointer;transition:all .18s;display:inline-flex;align-items:center;gap:6px}
.btn-g{background:linear-gradient(135deg,var(--gold),var(--gold-l));color:var(--bg-0);box-shadow:0 3px 14px rgba(201,162,39,.25)}.btn-g:hover{box-shadow:0 5px 22px rgba(201,162,39,.35);transform:translateY(-1px)}.btn-g:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
.btn-s{background:var(--bg-3);color:var(--t1);border:1px solid var(--border)}.btn-s:hover{border-color:var(--t3)}
.btn-sm{padding:7px 14px;font-size:11px;border-radius:6px;background:var(--bg-3);color:var(--t1);border:1px solid var(--border);font-family:'Manrope',sans-serif;font-weight:600;cursor:pointer;transition:all .15s}.btn-sm:hover{border-color:var(--t3)}
.btn-g-sm{background:linear-gradient(135deg,var(--gold),var(--gold-l));color:var(--bg-0);border:none}
.btn-icon{background:none;border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:14px;transition:all .15s}.btn-icon:hover{border-color:var(--gold);background:var(--gold-d)}
.btn-row{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}
.search-bar{margin-bottom:16px}.search-bar input{font-size:14px;padding:12px 16px}
.client-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.client-card{cursor:pointer;position:relative;padding:20px}
.client-card:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,.3)}
.cc-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.cc-avatar{width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,var(--gold),var(--gold-l));display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:800;font-size:20px;color:var(--bg-0)}
.cc-avatar.lg{width:56px;height:56px;font-size:26px}
.cc-status-dot{width:8px;height:8px;border-radius:50%;background:var(--emerald)}
.cc-name{font-weight:700;font-size:16px;margin-bottom:2px}.cc-email{font-size:12px;color:var(--t3);margin-bottom:12px}
.cc-stats-row{display:flex;gap:16px;margin-bottom:12px;padding:10px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.cc-stat{display:flex;flex-direction:column;align-items:center;gap:2px}.cc-stat-n{font-family:'Playfair Display',serif;font-size:20px;font-weight:700}.cc-stat-n.cc-em{color:var(--emerald)}.cc-stat-l{font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px}
.cc-actions{display:flex;gap:6px;justify-content:flex-end}
.client-form-card{margin-bottom:20px}
.detail-header{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.detail-header h2{flex:1}
.detail-meta{display:flex;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--t3);margin-top:4px}
.detail-notes{margin-top:16px;padding:12px;background:var(--bg-1);border-radius:8px;font-size:13px;color:var(--t2);line-height:1.5}
.wiz-steps{display:flex;gap:4px;margin-bottom:24px;overflow-x:auto}
.wiz-s{display:flex;align-items:center;gap:5px;padding:7px 12px;border-radius:7px;background:var(--bg-2);border:1px solid var(--border);font-size:11px;color:var(--t3);white-space:nowrap;transition:all .2s}
.wiz-s.on{border-color:var(--gold);color:var(--gold);background:var(--gold-d)}.wiz-s.done{border-color:var(--emerald);color:var(--emerald);background:rgba(45,212,168,.08)}
.wiz-n{width:18px;height:18px;border-radius:50%;background:var(--bg-3);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px}
.wiz-s.on .wiz-n{background:var(--gold);color:var(--bg-0)}.wiz-s.done .wiz-n{background:var(--emerald);color:var(--bg-0)}.wiz-l{font-weight:600}
.input-modes{display:flex;gap:16px;align-items:stretch;margin-bottom:12px}
.upload-zone{min-width:180px;padding:24px 16px;border:2px dashed rgba(201,162,39,.2);border-radius:var(--r2);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;text-align:center}
.upload-zone:hover{border-color:var(--gold);background:var(--gold-d)}
.or-div{display:flex;align-items:center;padding:0 6px;color:var(--t3);font-size:11px;font-weight:700;text-transform:uppercase}
.report-ta{min-height:180px!important;font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.6}
.text-stats{display:flex;gap:8px;font-size:11px;color:var(--t3);margin-bottom:6px}
.flags-hdr{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}.flags-act{display:flex;gap:6px}
.flags-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-bottom:14px}
.flag-card{background:var(--bg-2);border:2px solid var(--border);border-radius:var(--r2);padding:16px;cursor:pointer;transition:all .2s}
.flag-card:hover{border-color:var(--t3)}.flag-card.selected{border-color:var(--gold);background:var(--gold-d)}
.flag-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.flag-chk{width:20px;height:20px;border:2px solid var(--t3);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--bg-0);transition:all .15s}
.flag-chk.on{background:var(--gold);border-color:var(--gold)}
.flag-sev{padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border:1px solid}
.flag-acct{font-weight:700;font-size:14px;margin-bottom:2px}.flag-num{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--t3);margin-bottom:4px}
.flag-iss{font-size:12px;font-weight:600;color:var(--gold);margin-bottom:4px}.flag-exp{font-size:11px;color:var(--t2);line-height:1.45;margin-bottom:6px}
.flag-fcra{font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--emerald);background:rgba(45,212,168,.08);padding:3px 7px;border-radius:4px;display:inline-block}
.target-row{display:flex;gap:10px;margin-bottom:18px}.tcard{flex:1;padding:14px;border-radius:var(--r);border:2px solid var(--border);background:var(--bg-1);cursor:pointer;transition:all .18s}.tcard:hover{border-color:var(--t3)}.tcard.on{border-color:var(--gold);background:var(--gold-d)}
.ti{font-size:22px;margin-bottom:4px}.tl{font-weight:700;font-size:13px;margin-bottom:2px}.td{font-size:10px;color:var(--t3)}
.bureau-row{display:flex;gap:8px;margin-bottom:18px}.bchip{flex:1;padding:12px;border-radius:var(--r);border:2px solid var(--border);background:var(--bg-1);cursor:pointer;transition:all .18s;text-align:center}.bchip:hover{border-color:var(--t3)}.bchip.on{border-color:var(--gold);background:var(--gold-d)}
.bn{font-weight:700;font-size:13px}.ba{font-size:9px;color:var(--t3);margin-top:2px;white-space:pre-line;line-height:1.3}
.summary-box{background:var(--bg-1);border:1px solid var(--border);border-radius:var(--r);padding:14px 18px;margin-top:14px}
.sum-t{font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.sum-r{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;color:var(--t2)}.sum-r strong{color:var(--t1)}
.letters-list{display:flex;flex-direction:column;gap:10px}.ltr-card{overflow:hidden}
.lc-hdr{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.lc-n{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--gold);font-weight:600;margin-bottom:1px}.lc-a{font-weight:700;font-size:15px}.lc-i{font-size:11px;color:var(--t3);margin-top:1px}
.letter{background:#fdfcf6;border:1px solid #e0dbd0;border-radius:var(--r);padding:32px;color:#1a1a1a;font-family:'IBM Plex Mono',monospace;font-size:11.5px;line-height:1.8;white-space:pre-wrap;max-height:480px;overflow-y:auto;margin-top:14px}
.prog-bar{height:4px;background:var(--bg-1);border-radius:2px;overflow:hidden;margin-top:14px}.prog-fill{height:100%;background:linear-gradient(135deg,var(--gold),var(--gold-l));border-radius:2px;transition:width .4s}
.loading-box{text-align:center;padding:36px 20px;margin-top:14px}
.spinner{width:44px;height:44px;border:3px solid var(--border);border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
.gen-text{font-size:15px;color:var(--t2);margin-bottom:4px}.gen-sub{font-size:12px;color:var(--t3)}
.law-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.law{padding:20px}.law .ls{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--gold);font-weight:600;margin-bottom:1px}.law .lu{font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--t3);margin-bottom:5px}
.law .lt{font-family:'Playfair Display',serif;font-size:16px;margin-bottom:6px}.law .lsm{font-size:12px;color:var(--t2);line-height:1.5;margin-bottom:8px}
.law .luse{font-size:10px;color:var(--emerald);font-weight:600;padding:4px 8px;background:rgba(45,212,168,.08);border-radius:4px;display:inline-block}
.callout{display:flex;gap:14px;align-items:flex-start;background:rgba(201,162,39,.04);border:1px solid rgba(201,162,39,.12)}
.callout h4{font-family:'Playfair Display',serif;font-size:16px;color:var(--gold);margin-bottom:4px}.callout p{font-size:12px;color:var(--t2);line-height:1.6}
.ttable{width:100%;border-collapse:separate;border-spacing:0 5px}.ttable th{text-align:left;padding:8px 12px;font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:1px;font-weight:700}
.ttable td{padding:12px;background:var(--bg-2);color:var(--t1);font-size:12px}.ttable tr td:first-child{border-radius:7px 0 0 7px}.ttable tr td:last-child{border-radius:0 7px 7px 0}
.badge{padding:3px 9px;border-radius:14px;font-size:10px;font-weight:700;display:inline-block}
.b-pending{background:rgba(251,191,36,.12);color:#fbbf24}.b-investigating{background:rgba(91,156,246,.12);color:var(--blue)}.b-resolved{background:rgba(45,212,168,.12);color:var(--emerald)}.b-rejected{background:rgba(239,100,97,.12);color:var(--red)}
.mono-sm{font-family:'IBM Plex Mono',monospace;font-size:11px}.c-em{color:var(--emerald)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:28px}
.stat{padding:20px}.stat .lbl{font-size:10px;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.stat .val{font-family:'Playfair Display',serif;font-size:30px;line-height:1}.stat .sub{font-size:11px;color:var(--emerald);margin-top:4px;font-weight:600}
.clitem{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer}.clitem:last-child{border-bottom:none}
.clbox{width:18px;height:18px;border:2px solid var(--t3);border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;margin-top:2px;font-size:12px;font-weight:800;color:var(--bg-0)}
.clbox.ck{background:var(--gold);border-color:var(--gold)}.cltext{font-size:13px;color:var(--t2);line-height:1.5}.cltext.done{text-decoration:line-through;color:var(--t3)}
.err-box{background:rgba(239,100,97,.08);border:1px solid rgba(239,100,97,.2);border-radius:var(--r);padding:12px 16px;margin-bottom:14px;color:var(--red);font-size:12px;line-height:1.5}
.empty{text-align:center;padding:40px 16px;color:var(--t3)}
.status-sel{background:var(--bg-1);border:1px solid var(--border);border-radius:5px;padding:4px 8px;color:var(--t1);font-family:'Manrope',sans-serif;font-size:11px;font-weight:600;cursor:pointer;outline:none}.status-sel:focus{border-color:var(--gold)}
@keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}.fu{animation:fu .4s ease-out forwards}
@media(max-width:768px){.hdr-in{padding:0 12px}.main{padding:12px}.fgrid{grid-template-columns:1fr}.flags-grid,.client-grid{grid-template-columns:1fr}.bureau-row,.target-row{flex-direction:column}.law-grid{grid-template-columns:1fr}.tabs{overflow-x:auto;-webkit-overflow-scrolling:touch}.input-modes{flex-direction:column}.or-div{padding:6px 0}.wiz-l{display:none}.detail-header{flex-direction:column;align-items:flex-start}}
`;
