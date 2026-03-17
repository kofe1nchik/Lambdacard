chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-lambdacards",
    title: "Lambdacards: Добавить '%s'",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-to-lambdacards") {
    const text = info.selectionText.trim();
    if (!text) return;

    const url = chrome.runtime.getURL(
      `popup.html?quickAdd=${encodeURIComponent(text)}`,
    );

    chrome.windows.create({
      url: url,
      type: "popup",
      width: 360,
      height: 580,
      focused: true,
    });
  }
});
