import type { ActionHandler, ActionType } from "./types.js";
import { browseAction } from "./browse.js";
import { clickAction } from "./click.js";
import { fillAction } from "./fill.js";
import { typeAction } from "./type.js";
import { hoverAction } from "./hover.js";
import { pressAction } from "./press.js";
import { scrollAction } from "./scroll.js";
import { selectAction } from "./select.js";
import { snapshotAction } from "./snapshot.js";
import { screenshotAction } from "./screenshot.js";
import { searchAction } from "./search.js";
import { stateAction } from "./state.js";
import { extractAction } from "./extract.js";
import { evalAction } from "./eval.js";
import { networkAction } from "./network.js";
import { backAction, forwardAction, waitAction, closeAction } from "./navigation.js";
import { tabListAction, tabNewAction, tabSelectAction } from "./tabs.js";
import { siteAction } from "./site.js";
import { devAction } from "./dev.js";

export const actionHandlers: Record<ActionType, ActionHandler> = {
  browse: browseAction,
  click: clickAction,
  fill: fillAction,
  type: typeAction,
  hover: hoverAction,
  press: pressAction,
  scroll: scrollAction,
  select: selectAction,
  snapshot: snapshotAction,
  screenshot: screenshotAction,
  search: searchAction,
  state: stateAction,
  extract: extractAction,
  eval: evalAction,
  network: networkAction,
  back: backAction,
  forward: forwardAction,
  wait: waitAction,
  close: closeAction,
  tab_list: tabListAction,
  tab_new: tabNewAction,
  tab_select: tabSelectAction,
  site: siteAction,
  dev: devAction,
};
