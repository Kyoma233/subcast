// Settings › AI 模型: what answers questions and translates, in plain words. Local agents the listener already has
// (Claude Code and the like) come first and need no key; API services follow, the long list folded away.
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Check, ChevronDown, Copy, Loader2, RefreshCw, TerminalSquare } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorText, llmChat, type Provider } from "../lib/api";
import { AGENTS, agentOf, agentProvider, agentProviderId, detectAgents, useAgents, type AgentKind, type FoundAgent } from "../lib/agents";
import { GROUPS } from "../lib/settings";
import { DefaultButton } from "./SettingsDialog";
import { Seg } from "./ReadingSettings";
import { providerIcon } from "../lib/providerIcons";
import { useStore } from "../store";
import { t, tk, tr, useLang } from "../lib/i18n";

/** The service's own mark where we have it, else its initials on a tint. */
function Mark({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  const icon = providerIcon(id);
  if (icon) return <span className="ms-mark has-icon" style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: icon }} />;
  const letters = name.replace(/[（(].*$/, "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return <span className="ms-mark" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>{letters}</span>;
}

const RECOMMENDED = ["bilibili", "deepseek", "siliconflow", "openrouter"];

const STATUS: Record<FoundAgent["login"], { text: string; tone: "ok" | "warn" | "idle" }> = {
  ready: { text: tk("可用"), tone: "ok" },
  needsLogin: { text: tk("需要登录"), tone: "warn" },
  unknown: { text: tk("待确认"), tone: "idle" },
};

export function ModelSettings({ ProviderEditor }: { ProviderEditor: (props: { p: Provider; onChange: (p: Provider) => void }) => React.ReactElement }) {
  const { settings, saveSettings } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings })));
  const { found, checking } = useAgents();
  useLang((s) => s.lang);
  const [editing, setEditing] = useState<string>(settings.chatProvider);
  const [more, setMore] = useState(false);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  useEffect(() => { if (found == null) void detectAgents(); }, []);
  const apiProviders = useMemo(() => Object.values(settings.providers).filter((p) => p.protocol !== "cli"), [settings.providers]);
  useEffect(() => {
    void Promise.all(apiProviders.filter((p) => p.needsKey).map(async (p) => [p.id, await api.hasApiKey(p.id)] as const)).then((r) => setKeys(Object.fromEntries(r)));
  }, [apiProviders.length, editing]);

  const used = (id: string) => (settings.translateProvider === id && settings.translateMode !== "google" ? t("默认") : "");
  const ready = (p: Provider) => !p.needsKey || keys[p.id];
  const mine = apiProviders.filter((p) => RECOMMENDED.includes(p.id) || (p.needsKey && keys[p.id]) || settings.chatProvider === p.id || settings.translateProvider === p.id);
  const rest = apiProviders.filter((p) => !mine.includes(p));
  const p = settings.providers[editing];
  const agent = agentOf(p);
  const update = (np: Provider) => void saveSettings({ providers: { ...settings.providers, [np.id]: np }, ...(np.id === settings.chatProvider && np.model !== p?.model ? { chatModel: "" } : {}) });
  const nameOf = (id: string) => { const x = settings.providers[id]; return x ? tr(x.name) : ""; };
  const google = settings.translateMode === "google";
  const translateName = google ? t("谷歌翻译（免费）") : nameOf(settings.translateProvider) || t("没有设置");
  const split = google || settings.chatProvider !== settings.translateProvider;
  const [advanced, setAdvanced] = useState(split);
  // Every model the listener can actually pick: detected agents plus API services that are ready.
  const choices = [
    ...(found ?? []).map((f) => ({ id: agentProviderId(f.kind), name: AGENTS[f.kind].name })),
    ...apiProviders.filter(ready).map((x) => ({ id: x.id, name: tr(x.name) })),
  ];
  // A translation-only model can't answer questions, so it is offered for subtitles only.
  const chatChoices = choices.filter((c) => !settings.providers[c.id]?.translateOnly);
  const withCurrent = (id: string, from = choices) =>
    (from.some((c) => c.id === id) || !settings.providers[id] ? from : [...from, { id, name: nameOf(id) }]);
  const translateOnly = Boolean(settings.providers[settings.translateProvider]?.translateOnly);

  return (
    <div className="ms">
      <div className="ms-uses">
        <div className="ms-use">
          {split
            ? <b>{t("问答：{a} · 字幕翻译：{b}", { a: nameOf(settings.chatProvider) || t("没有设置"), b: translateName })}</b>
            : <b>{t("当前：{name}", { name: nameOf(settings.chatProvider) || t("没有设置") })}<span className="muted small"> · {t("管问答、导读和翻译")}</span></b>}
        </div>
        {settings.autoPicked && settings.chatProvider === settings.autoPicked && !settings.modelChosen && (
          <p className="ms-auto small">{t("检测到你已登录 {name}，已自动设为默认模型。", { name: nameOf(settings.autoPicked) })}</p>
        )}
      </div>
      <div className="ms-split">
        <aside className="ms-list">
          <div className="ms-group-h">
            <span>{t("本机 AI")}<em>{t("用你已有的订阅，不需要 Key")}</em></span>
            <button className="icon-btn sm" title={t("重新检测")} aria-label={t("重新检测")} onClick={() => void detectAgents()} disabled={checking}>{checking ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}</button>
          </div>
          {found == null ? <p className="muted small ms-empty"><Loader2 size={12} className="spin" /> {t("正在查找本机的 AI 工具…")}</p>
            : found.length === 0 ? <p className="muted small ms-empty">{t("没有找到。装好 Claude Code 或 Codex 并登录后，点上面的刷新。")}</p>
            : found.map((f) => {
              const id = agentProviderId(f.kind);
              const st = STATUS[f.login];
              return (
                <button key={f.kind} className={`ms-item ${editing === id ? "on" : ""}`} onClick={() => setEditing(id)}>
                  <Mark id={id} name={AGENTS[f.kind].name} />
                  <span className="ms-item-name">{AGENTS[f.kind].name}<small>{used(id) || t(st.text)}</small></span>
                  <span className={`ms-dot ${st.tone}`} aria-label={t(st.text)} />
                </button>
              );
            })}
          <div className="ms-group-h"><span>{t("API 模型")}<em>{t("填 Key 使用，按量付费")}</em></span></div>
          {mine.map((x) => (
            <button key={x.id} className={`ms-item ${editing === x.id ? "on" : ""}`} onClick={() => setEditing(x.id)}>
              <Mark id={x.id} name={tr(x.name)} />
              <span className="ms-item-name">{tr(x.name)}<small>{used(x.id) || (ready(x) ? (x.free ? t("免费使用") : t("已填 Key")) : t("未设置"))}</small></span>
              <span className={`ms-dot ${ready(x) ? "ok" : "idle"}`} />
            </button>
          ))}
          <button className="ms-more" aria-expanded={more} onClick={() => setMore(!more)}><ChevronDown size={13} className={more ? "flip" : ""} /> {more ? t("收起") : t("更多服务商（{n}）", { n: rest.length })}</button>
          {more && GROUPS.map((g) => {
            const list = rest.filter((x) => (x.group ?? "provider") === g.id);
            return list.length ? (
              <div key={g.id}>
                <p className="ms-sub-h">{t(g.name)}</p>
                {list.map((x) => (
                  <button key={x.id} className={`ms-item slim ${editing === x.id ? "on" : ""}`} onClick={() => setEditing(x.id)}>
                    <Mark id={x.id} name={tr(x.name)} size={20} />
                    <span className="ms-item-name">{tr(x.name)}</span>
                  </button>
                ))}
              </div>
            ) : null;
          })}
        </aside>
        <section className="ms-detail">
          {agent ? <AgentDetail kind={agent} found={found?.find((f) => f.kind === agent)} p={p ?? agentProvider(agent)} onChange={update} />
            : p ? (
              <>
                <div className="ms-head"><Mark id={p.id} name={tr(p.name)} size={36} /><div><p className="ms-title">{tr(p.name)}</p><p className="muted small">{p.group === "local" ? t("在你电脑上运行的模型服务，不需要 Key。") : p.free ? t("公网上的免费服务，不用 Key，也不用装显卡。") : t("用你自己的 API Key，按用量付费给服务商。Key 只存在本机钥匙串。")}</p></div></div>
                <ProviderEditor key={p.id} p={p} onChange={update} />
              </>
            ) : null}
        </section>
      </div>
      <button className="ms-more ms-adv" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><ChevronDown size={13} className={advanced ? "flip" : ""} /> {t("问答和翻译分别用不同模型")}</button>
      {advanced && (
        <div className="setup-block ms-adv-body">
          <div className="reading-row">
            <span>{t("问答和导读")}</span>
            <select value={settings.chatProvider} onChange={(e) => void saveSettings({ chatProvider: e.target.value, chatModel: "", modelChosen: true })}>
              {withCurrent(settings.chatProvider, chatChoices).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="reading-row">
            <span>{t("字幕翻译")}</span>
            <select value={google ? "google" : settings.translateProvider} onChange={(e) => void saveSettings(e.target.value === "google" ? { translateMode: "google" } : { translateMode: "auto", translateProvider: e.target.value, modelChosen: true })}>
              <option value="google">{t("谷歌翻译（免费）")}</option>
              {withCurrent(settings.translateProvider).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {!google && (translateOnly
            ? <p className="muted small">{t("这个模型只做翻译，没有「精翻」润色这一步。")}</p>
            : <>
              <div className="reading-row">
                <span>{t("翻译方式")}</span>
                <Seg value={settings.translateQuality} options={[["fast", t("快速")], ["best", t("精翻")]]} onChange={(q) => void saveSettings({ translateQuality: q })} />
              </div>
              <p className="muted small">{settings.translateQuality === "best" ? t("翻完再通读润色一遍，更准，时间和费用约多一倍。") : t("一遍翻完，最快。")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AgentDetail({ kind, found, p, onChange }: { kind: AgentKind; found?: FoundAgent; p: Provider; onChange: (p: Provider) => void }) {
  const settings = useStore((s) => s.settings);
  const info = AGENTS[kind];
  const [login, setLogin] = useState(found?.login ?? "unknown");
  const [busy, setBusy] = useState<"probe" | "test" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setLogin(found?.login ?? "unknown"); setResult(null); }, [kind, found?.login]);
  const id = agentProviderId(kind);
  const forTranslate = settings.translateProvider === id && settings.translateMode !== "google";
  const probe = async () => {
    setBusy("probe"); setResult(null);
    try { const r = await invoke<string>("probe_agent", { kind }); setLogin(r as FoundAgent["login"]); }
    catch (e) { setResult({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  };
  const test = async () => {
    setBusy("test"); setResult(null);
    const t0 = performance.now();
    try {
      const r = await llmChat({ provider: p, system: "Reply with one short word.", messages: [{ role: "user", content: "ping" }], maxTokens: 50 });
      setResult({ ok: true, text: t("可用 ✓ {reply}（{s} 秒）", { reply: r.trim().slice(0, 16), s: ((performance.now() - t0) / 1000).toFixed(1) }) });
      setLogin("ready");
    } catch (e) { setResult({ ok: false, text: errorText(e) }); } finally { setBusy(null); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(info.login); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard off */ } };
  const st = STATUS[login];
  return (
    <div className="provider-form">
      <div className="ms-head">
        <Mark id={id} name={info.name} size={36} />
        <div><p className="ms-title">{info.name} <span className={`ms-pill ${st.tone}`}>{t(st.text)}</span></p><p className="muted small">{info.vendor}{found?.version ? ` · ${found.version}` : ""}</p></div>
      </div>
      <p className="ms-lead">{t("用你自己的 {plan}，不需要 API Key。用量计入你的订阅额度。", { plan: t(info.plan) })}</p>
      {login === "needsLogin" && (
        <div className="ms-callout">
          <TerminalSquare size={16} />
          <div>
            <p>{t("还没有登录。打开「终端」，输入下面的命令并回车，按提示登录，然后回来点「重新检测」。")}</p>
            <div className="ms-cmd"><code>{info.login}</code><button className="icon-btn sm" onClick={copy} aria-label={t("复制")}>{copied ? <Check size={13} /> : <Copy size={13} />}</button></div>
          </div>
        </div>
      )}
      <div className="setup-block">
        <DefaultButton id={id} isDefault={forTranslate} />
        <p className="muted small">{t("本机 AI 每次回答要先启动几秒，SubCast 会让它保持运行，后面会快一些。整集翻译比 API 慢。")}</p>
      </div>
      <div className="setup-block">
        <p className="setup-title">{t("模型")}</p>
        <div className="ms-model">
          <select value={p.model || ""} onChange={(e) => onChange({ ...p, model: e.target.value })}>
            <option value="">{t("跟随 {name} 的设置（推荐）", { name: info.name })}</option>
            {[...new Set([...(info.models ?? []), ...(p.model ? [p.model] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <div className="row-actions">
        <button className="btn sm" onClick={test} disabled={busy != null}>{busy === "test" && <Loader2 size={13} className="spin" />} {t("试一下")}</button>
        {login === "unknown" && <button className="btn ghost sm" onClick={probe} disabled={busy != null}>{busy === "probe" && <Loader2 size={13} className="spin" />} {t("检测是否已登录")}</button>}
        {result && <span className={result.ok ? "ok-text small" : "error-text small"}>{result.text}</span>}
        <span className="spacer" />
        <button className="link-btn small" onClick={() => void openUrl(info.install)}>{t("关于 {name}", { name: info.name })}</button>
      </div>
      <p className="muted small ms-foot">{t("字幕和你的问题会交给本机的 {name}，由它连接 {vendor} 的服务。它在一个空文件夹里运行，不能读写你的文件，也不能执行命令。", { name: info.name, vendor: info.vendor })}</p>
    </div>
  );
}
