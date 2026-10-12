import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "@awesome.me/webawesome/dist/components/drawer/drawer.js";
import "@awesome.me/webawesome/dist/components/details/details.js";
import "@awesome.me/webawesome/dist/translations/zh-cn.js";
import { registerIconLibrary } from "@awesome.me/webawesome/dist/components/icon/library.js";
import {
  createIcons,
  createElement,
  MapPin,
  Map,
  Bookmark,
  BookmarkPlus,
  Settings2,
  CircleHelp,
  ChevronRight,
  ChevronDown,
  Search,
  MousePointer2,
  Plus,
  Minus,
  LocateFixed,
  Smartphone,
  RefreshCw,
  ShieldCheck,
  ArrowUpRight,
  RotateCcw,
  Info,
  Power,
  X,
  Moon,
  Sun,
  Monitor,
  Palette,
  Trash2,
} from "lucide";
import "@awesome.me/webawesome/dist/styles/themes/default.css";

const icons = {
  MapPin,
  Map,
  Bookmark,
  BookmarkPlus,
  Settings2,
  CircleHelp,
  ChevronRight,
  ChevronDown,
  Search,
  MousePointer2,
  Plus,
  Minus,
  LocateFixed,
  Smartphone,
  RefreshCw,
  ShieldCheck,
  ArrowUpRight,
  RotateCcw,
  Info,
  Power,
  X,
  Moon,
  Sun,
  Monitor,
  Palette,
  Trash2,
};
// Components load only local SVGs. Android serves them from its virtual HTTPS origin.
registerIconLibrary("system", {
  resolver: (name) => "/vendor/ui-icons/" + name + ".svg",
});
const icon = (name) =>
  createElement(icons[name], { "aria-hidden": "true", "stroke-width": 1.75 });
window.DingDianUI = { icon };
createIcons({ icons, attrs: { "aria-hidden": "true", "stroke-width": 1.75 } });
