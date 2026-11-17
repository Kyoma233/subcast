import { ConfirmHost } from "./components/ConfirmHost";
import { useShallow } from "zustand/react/shallow";
import { Splitter } from "./components/Splitter";
import { SelectionTools } from "./components/SelectionTools";
import { SIDEBAR, useLayout } from "./lib/layout";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import { startJobListeners } from "./lib/jobs";
import { useStore } from "./store";
import { AddDialog, MiniPlayer, Sidebar, Toast, TopBar } from "./components/Chrome";
import { DiscoverView, DownloadsView, LatestView, RecentView, ShowView, ChannelView } from "./components/Lists";
import { startOffline } from "./lib/offline";
import { loadFavorites } from "./lib/library";
import { startUpdateChecks } from "./lib/updater";
import { UpdateBanner } from "./components/UpdateBanner";
import { EpisodeView } from "./components/EpisodeView";
import { AudioEngine, cycleMode, cycleRate } from "./components/Players";
import { useJobs } from "./lib/jobs";
import { activeIndex } from "./components/TranscriptPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { t, useLang } from "./lib/i18n";
import { EqBars } from "./components/Illustrations";
import { useIsPhone } from "./lib/phone";

export default function App() {
  const { ready, view, settingsOpen, addOpen, init } = useStore(useShallow((s) => ({ ready: s.ready, view: s.view, settingsOpen: s.settingsOpen, addOpen: s.addOpen, init: s.init })));

  useEffect(() => {
    startJobListeners();
    void startOffline();
    void loadFavorites();
    startUpdateChecks();
    void init();
    // Rendered: tells the app a hot-updated interface works (otherwise it falls back on its own; see ota.rs).
    void api.uiReady().then((info) => useStore.setState({ uiBuild: info.build })).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); useStore.getState().openSettings(); return; }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "l") {
        const box = document.querySelector<HTMLInputElement>(".top-search input");
        if (box) { e.preventDefault(); box.focus(); box.select(); }
        return;
      }
      if (t.closest("input, textarea, select, [contenteditable], [role=separator]")) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "\\")) {
        e.preventDefault();
        const l = useLayout.getState();
        if (e.key === "b") l.put({ sideOpen: !l.sideOpen }); else l.put({ panelOpen: !l.panelOpen });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { player, time, current } = useStore.getState();
      const segs = current ? useJobs.getState().transcripts[current.id]?.segments : undefined;
      if (e.code === "Space") { e.preventDefault(); player?.toggle(); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); player?.seek(Math.max(0, time - (e.shiftKey ? 5 : 15))); }
      else if (e.code === "ArrowRight") { e.preventDefault(); player?.seek(time + (e.shiftKey ? 5 : 30)); }
      else if ((e.code === "ArrowUp" || e.code === "ArrowDown") && segs?.length) {
        e.preventDefault();
        const i = activeIndex(segs, time);
        const j = Math.min(segs.length - 1, Math.max(0, e.code === "ArrowUp" ? (time - (segs[i]?.start ?? 0) > 2 ? i : i - 1) : i + 1));
        player?.seek(segs[j].start);
      }
      else if (e.code === "KeyC") cycleMode();
      else if (e.code === "KeyS") cycleRate();
    };
    window.addEventListener("keydown", onKey);
    const scrollTimers = new WeakMap<Element, number>();
    const onScroll = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      el.classList.add("is-scrolling");
      window.clearTimeout(scrollTimers.get(el));
      scrollTimers.set(el, window.setTimeout(() => el.classList.remove("is-scrolling"), 900));
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const offMenu = listen("open-settings", () => useStore.getState().openSettings());
    // The first time our subtitles help someone else, say so once (and where to turn it off).
    const offShared = listen("shared-upload", () => {
      if (localStorage.getItem("sharedNoticeShown")) return;
      localStorage.setItem("sharedNoticeShown", "1");
      useStore.getState().notify(t("你的字幕已匿名分享给其他听友（设置 › 通用 可关闭）"));
    });
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("scroll", onScroll, { capture: true }); void offMenu.then((f) => f()); void offShared.then((f) => f()); };
  }, []);

  const { sidebar, sideOpen, put: putLayout } = useLayout();
  const phone = useIsPhone();
  // A phone starts with the drawer shut and the subtitle panel closed: the player comes first.
  useEffect(() => {
    if (!phone || localStorage.getItem("phone-layout")) return;
    localStorage.setItem("phone-layout", "1");
    useLayout.getState().put({ sideOpen: false, panelOpen: false });
  }, [phone]);
  useLang(); // re-render the tree when the interface language changes
  if (!ready) return <div className="boot" role="status" aria-label={t("正在启动")}><EqBars /></div>;
  return (
    <div className={`app ${sideOpen ? "" : "side-collapsed"} ${phone && sideOpen ? "drawer-open" : ""}`} style={{ "--sidebar-w": `${sideOpen ? sidebar : 72}px` } as React.CSSProperties}>
      {phone && sideOpen && <div className="scrim" onClick={() => putLayout({ sideOpen: false })} />}
      <Sidebar />
      <Splitter value={sideOpen ? sidebar : 72} min={SIDEBAR.min} max={SIDEBAR.max} def={SIDEBAR.def} snap={SIDEBAR.snap} edge="right" label={t("侧栏宽度")} onChange={(w) => putLayout({ sidebar: w, sideOpen: true })} onCollapse={() => putLayout({ sideOpen: false })} />
      <main className="main">
        {view.kind !== "episode" && <TopBar />}
        {view.kind === "latest" && <LatestView />}
        {view.kind === "recent" && <RecentView />}
        {view.kind === "discover" && <DiscoverView />}
        {view.kind === "downloads" && <DownloadsView />}
        {view.kind === "show" && <ShowView key={view.id} id={view.id} />}
        {view.kind === "channel" && <ChannelView key={view.input} input={view.input} />}
        {view.kind === "episode" && <EpisodeView key={view.id} id={view.id} />}
      </main>
      <MiniPlayer />
      <AudioEngine />
      {settingsOpen && <SettingsDialog />}
      {addOpen && <AddDialog />}
      <SelectionTools />
      <UpdateBanner />
      <ConfirmHost />
      <Toast />
    </div>
  );
}
