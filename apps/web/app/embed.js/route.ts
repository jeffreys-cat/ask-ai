const SCRIPT = String.raw`
(function () {
  var script = document.currentScript;
  if (!script) return;

  var scriptUrl = new URL(script.src);
  var baseUrl = script.dataset.baseUrl || scriptUrl.origin;
  var zIndex = script.dataset.zIndex || "2147483000";
  var buttonLabel = script.dataset.buttonLabel || "Ask AI";
  var title = script.dataset.title || "Ask AI";
  var position = script.dataset.position || "bottom-right";
  var primaryColor = script.dataset.primaryColor || "#087f5b";
  var params = new URLSearchParams();
  var configKeys = ["projectId", "organizationId", "userId", "title", "placeholder", "brand", "primaryColor"];

  configKeys.forEach(function (key) {
    if (script.dataset[key]) params.set(key, script.dataset[key]);
  });
  if (!params.has("title")) params.set("title", title);
  if (!params.has("primaryColor")) params.set("primaryColor", primaryColor);

  var host = document.createElement("div");
  host.id = "ask-ai-embed-root";
  document.body.appendChild(host);

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Open " + buttonLabel);
  button.textContent = buttonLabel;
  button.style.cssText = [
    "position:fixed",
    position.indexOf("top") === 0 ? "top:24px" : "bottom:24px",
    position.indexOf("left") > -1 ? "left:24px" : "right:24px",
    "z-index:" + zIndex,
    "height:54px",
    "padding:0 22px",
    "border:0",
    "border-radius:999px",
    "background:" + primaryColor,
    "color:#fff",
    "box-shadow:0 14px 34px rgba(0,0,0,.22)",
    "font:600 15px/1.1 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "cursor:pointer"
  ].join(";");

  var iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.allow = "clipboard-write";
  iframe.src = baseUrl.replace(/\/$/, "") + "/embed?" + params.toString();
  iframe.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:" + (Number(zIndex) + 1),
    "width:100vw",
    "height:100vh",
    "border:0",
    "display:none",
    "background:transparent"
  ].join(";");

  function open() {
    iframe.style.display = "block";
    button.style.display = "none";
  }

  function close() {
    iframe.style.display = "none";
    button.style.display = "inline-flex";
  }

  button.addEventListener("click", open);
  window.addEventListener("message", function (event) {
    if (event.source === iframe.contentWindow && event.data && event.data.type === "ask-ai:close") close();
  });

  host.appendChild(button);
  host.appendChild(iframe);
})();
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
