const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Missing application root");
}

const heading = document.createElement("h1");
heading.textContent = "Midnight Flash Sale";
app.append(heading);
