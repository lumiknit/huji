/* @refresh reload */
import { render } from "solid-js/web";
import { Route, HashRouter } from "@solidjs/router";
import { Toaster } from "solid-toast";
import CommonDialog from "./components/CommonDialog";
import { type Component, type JSX, ErrorBoundary, onMount } from "solid-js";
import { useSettingsInit } from "./states/settings";

import "./styles/index.css";

import FileListPage from "./pages/FileListPage";
import AboutPage from "./pages/AboutPage";
import EditorPage from "./pages/EditorPage";
import PreviewPage from "./pages/PreviewPage";
import SpecialEditPage from "./pages/SpecialEditPage";
import SettingsPage from "./pages/SettingsPage";
type LayoutProps = { children?: JSX.Element };

const Layout: Component<LayoutProps> = (props) => {
  useSettingsInit();

  onMount(() => {
    navigator.storage?.persist?.().catch(() => {});
  });

  return (
    <>
      <Toaster
        position="bottom-center"
        toastOptions={{
          duration: 3000,
          style: {
            color: "var(--c-fg)",
            background: "var(--c-bg)",
            border: "1px solid var(--c-border)",
            "border-radius": ".5rem",
            "box-shadow": "#4444 0px 3px 10px",
          },
        }}
      />
      <CommonDialog />
      <ErrorBoundary
        fallback={(err, reset) => (
          <div class="error-boundary">
            <h1>Something went wrong</h1>
            <p>{String(err?.message ?? err)}</p>
            <div class="error-boundary-actions">
              <button onClick={reset}>Retry</button>
              <button onClick={() => (location.hash = "#/")}>
                Back to file list
              </button>
            </div>
          </div>
        )}
      >
        {props.children}
      </ErrorBoundary>
    </>
  );
};

const root = document.getElementById("root")!;

render(
  () => (
    <HashRouter root={Layout}>
      <Route path="/" component={FileListPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/edit/:fileId" component={EditorPage} />
      <Route path="/preview/:fileId" component={PreviewPage} />
      <Route path="/edit/:fileId/esp" component={SpecialEditPage} />
      <Route path="/settings" component={SettingsPage} />
    </HashRouter>
  ),
  root,
);
