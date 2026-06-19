import { type Component } from "solid-js";
import { A } from "@solidjs/router";
import { TbOutlineArrowLeft } from "solid-icons/tb";
import Toolbar from "../components/Toolbar";

const AboutPage: Component = () => (
  <main>
    <Toolbar title="About">
      <A href="/" title="Back">
        <TbOutlineArrowLeft />
      </A>
    </Toolbar>

    <h1 class="about-title">
      huji <small>v{__APP_VERSION__}</small>
    </h1>
    <p class="about-desc text-muted">
      From Korean <em>휴지</em> (hyuji) — a scrap of tissue paper. Write on it
      like you would on a scrap: quickly, without ceremony.
    </p>

    <p class="about-body">
      A minimalist in-browser markdown editor. No account, no sync, no server —
      everything stays in your browser's local storage.
    </p>

    <p class="about-body">
      <a
        href="https://github.com/lumiknit/huji#readme"
        target="_blank"
        rel="noopener noreferrer"
      >
        github.com/lumiknit/huji
      </a>
    </p>
  </main>
);

export default AboutPage;
