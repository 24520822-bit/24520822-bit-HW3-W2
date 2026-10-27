import "./style.css";
import { mountFlashSaleApp } from "./main";

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  mountFlashSaleApp(app);
}
