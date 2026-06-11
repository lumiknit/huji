/* @refresh reload */
import { render } from "solid-js/web";
import { Route, HashRouter } from "@solidjs/router";
import { Toaster } from "solid-toast";
import { type Component, type JSX } from "solid-js";
import { useSettingsInit } from "./states/settings";

import "./styles/index.css";

import FileListPage from "./pages/FileListPage";
import AboutPage from "./pages/AboutPage";
import EditorPage from "./pages/EditorPage";
import PreviewPage from "./pages/PreviewPage";
import ReorderPage from "./pages/ReorderPage";
import SettingsPage from "./pages/SettingsPage";
import FindReplacePage from "./pages/FindReplacePage";

type LayoutProps = { children?: JSX.Element };

const Layout: Component<LayoutProps> = (props) => {
  useSettingsInit();
  return (
    <>
      <Toaster position="bottom-center" toastOptions={{ duration: 3000 }} />
      {props.children}
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
      <Route path="/reorder/:fileId" component={ReorderPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/find/:fileId" component={FindReplacePage} />
    </HashRouter>
  ),
  root,
);
