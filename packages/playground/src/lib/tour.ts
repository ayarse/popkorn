import { driver } from "driver.js";
import "driver.js/dist/driver.css";

const TOUR_SEEN_KEY = "popkorn-tour-seen";

/** Launch the onboarding tour over the current layout (targets must exist). */
export function startTour() {
  driver({
    showProgress: true,
    popoverClass: "popkorn-tour",
    nextBtnText: "Next",
    doneBtnText: "Done",
    onDestroyed: () => {
      try {
        localStorage.setItem(TOUR_SEEN_KEY, "1");
      } catch {
        // private mode / storage disabled — tour just won't be remembered.
      }
    },
    steps: [
      {
        element: '[data-tour="source"]',
        popover: {
          title: "Scene source",
          description:
            "Hand-editable CSS scene source — every edit renders live.",
          side: "right",
          align: "start",
        },
      },
      {
        element: '[data-tour="player"]',
        popover: {
          title: "Player",
          description: "Your scene, rendered in real time on the canvas.",
          side: "left",
          align: "start",
        },
      },
      {
        element: '[data-tour="examples"]',
        popover: {
          title: "Examples",
          description: "Browse the gallery of ready-made scenes to start from.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: '[data-tour="import"]',
        popover: {
          title: "Import",
          description:
            "Drop in a Lottie JSON or SVG — it converts to editable source.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: '[data-tour="copilot"]',
        popover: {
          title: "Copilot",
          description:
            "Describe a scene in plain English and let it write one.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: '[data-tour="timeline"]',
        popover: {
          title: "Timeline",
          description:
            "An After-Effects-style timeline — expand it to scrub keyframes.",
          side: "top",
          align: "start",
        },
      },
    ],
  }).drive();
}

/** First-run only: launch once, then never again (gated by a localStorage flag). */
export function maybeStartTour() {
  try {
    if (localStorage.getItem(TOUR_SEEN_KEY)) return;
  } catch {
    return; // storage blocked — don't nag on every load.
  }
  startTour();
}
