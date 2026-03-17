import "./styles.css";
import { dbApi } from "./db.js";
import { fsrs, generatorParameters, Rating } from "ts-fsrs";
import { translateText, debounce } from "./translate.js";
import { formatInterval } from "./dateUtils.js";
import {
  exportData,
  importJsonData,
  exportHistoryForOptimizer,
} from "./storageUtils.js";

let f = fsrs();
let currentDeckId = null;
let confirmCallback = null;
let alertCallback = null;

let studyQueue = [];
let currentCardIndex = 0;

let editingCardId = null;
let answerManuallyEdited = false;
let isQuickAddMode = false;
let previousScreen = "decks";

const defaultW = [
  0.40255, 1.18385, 3.173, 15.69105, 7.19605, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 0.22705, 0.20375, 2.7032, 0.01725,
  0.17475,
];

const appSettings = {
  darkMode: false,
  newCardsLimit: 20,
  translateEnabled: true,
  targetLang: "ru",
  fsrsWeights: defaultW,
};

// --- СПИСОК ЭКРАНОВ (VIEWS) ---
const views = {
  decks: document.getElementById("view-decks"),
  cards: document.getElementById("view-cards"),
  addCard: document.getElementById("view-add-card"),
  study: document.getElementById("view-study"),
  settings: document.getElementById("view-settings"),
  optimizer: document.getElementById("view-optimizer"),
};

document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

async function initApp() {
  loadSettings();
  setupEventListeners();

  const urlParams = new URLSearchParams(window.location.search);
  const quickAddText = urlParams.get("quickAdd");

  if (quickAddText) {
    isQuickAddMode = true;

    const defaultDeckId = await loadDeckSelectOptions();

    await openAddCardScreen(defaultDeckId);

    const qInput = document.getElementById("input-question");
    qInput.value = quickAddText;

    qInput.dispatchEvent(new Event("input"));
  } else {
    await renderDeckList();
  }
}

function showView(viewName) {
  Object.values(views).forEach((el) => {
    if (el) {
      el.classList.add("hidden");
      el.classList.remove("active");
    }
  });

  const targetView = views[viewName];
  if (targetView) {
    targetView.classList.remove("hidden");
    targetView.classList.add("active");
  } else {
    console.error(`Экрана "${viewName}" не существует в HTML!`);
  }
}

// --- ОБРАБОТЧИКИ СОБЫТИЙ ---
function setupEventListeners() {
  document.getElementById("btn-add-deck").addEventListener("click", () => {
    document.getElementById("modal-deck").classList.remove("hidden");
    document.getElementById("input-deck-name").focus();
  });

  document.getElementById("btn-cancel-deck").addEventListener("click", () => {
    closeModalAnimation("modal-deck");
  });
  document
    .getElementById("btn-confirm-deck")
    .addEventListener("click", handleCreateDeck);
  document
    .querySelector("#modal-deck .modal-backdrop")
    .addEventListener("click", () => {
      closeModalAnimation("modal-deck");
    });

  document.getElementById("btn-back-to-decks").addEventListener("click", () => {
    showView("decks");
    renderDeckList();
  });

  document.getElementById("btn-start-learn").addEventListener("click", () => {
    startStudySession(currentDeckId);
  });

  document
    .getElementById("btn-add-card-screen")
    .addEventListener("click", () => {
      openAddCardScreen(currentDeckId);
    });

  // --- МЕНЮ ОПЦИЙ КОЛОДЫ ---
  const btnOptions = document.getElementById("btn-deck-options");
  const modalOptions = document.getElementById("modal-deck-options");

  btnOptions.addEventListener("click", () => {
    modalOptions.classList.remove("hidden");
  });

  document.getElementById("btn-close-options").addEventListener("click", () => {
    closeModalAnimation("modal-deck-options");
  });
  modalOptions
    .querySelector(".modal-backdrop")
    .addEventListener("click", () => {
      closeModalAnimation("modal-deck-options");
    });

  document.getElementById("btn-opt-rename").addEventListener("click", () => {
    modalOptions.classList.add("hidden");

    const currentTitle =
      document.getElementById("current-deck-title").textContent;
    const renameInput = document.getElementById("input-rename-deck-name");
    renameInput.value = currentTitle;

    document.getElementById("modal-rename-deck").classList.remove("hidden");
    renameInput.focus();
  });

  document.getElementById("btn-rename-cancel").addEventListener("click", () => {
    closeModalAnimation("modal-rename-deck");
  });

  document
    .getElementById("btn-rename-confirm")
    .addEventListener("click", () => {
      const newName = document
        .getElementById("input-rename-deck-name")
        .value.trim();
      if (newName && newName !== "") {
        handleRenameDeck(currentDeckId, newName);
        closeModalAnimation("modal-rename-deck");
      }
    });

  document
    .querySelector("#modal-rename-deck .modal-backdrop")
    .addEventListener("click", () => {
      closeModalAnimation("modal-rename-deck");
    });

  document.getElementById("btn-opt-delete").addEventListener("click", () => {
    modalOptions.classList.add("hidden");
    handleDeleteDeck(currentDeckId);
  });

  // 3. ЭКРАН СОЗДАНИЯ КАРТОЧКИ

  document.getElementById("btn-back-to-cards").addEventListener("click", () => {
    if (isQuickAddMode) {
      window.close();
      return;
    }

    if (previousScreen === "cards") {
      showView("cards");
      renderCardList(currentDeckId);
    } else {
      showView("decks");
      renderDeckList();
    }
  });

  document
    .getElementById("btn-save-card")
    .addEventListener("click", handleSaveCard);

  // --- ЛОГИКА ПЕРЕВОДА И ВВОДА ---
  const qInput = document.getElementById("input-question");
  const aInput = document.getElementById("input-answer");

  aInput.addEventListener("input", () => {
    if (aInput.value.trim() !== "") {
      answerManuallyEdited = true;
    } else {
      answerManuallyEdited = false;
    }
  });

  qInput.addEventListener(
    "input",
    debounce(async (e) => {
      const text = e.target.value.trim();

      if (!text) {
        if (!answerManuallyEdited) {
          aInput.value = "";
        }
        return;
      }

      if (appSettings.translateEnabled && text && !answerManuallyEdited) {
        aInput.placeholder = "Перевожу...";
        const lang = appSettings.targetLang || "ru";
        const translation = await translateText(text, lang);

        if (translation) {
          aInput.value = translation;
        }
        aInput.placeholder = "Например: Яблоко";
      }
    }, 800),
  );

  document
    .getElementById("btn-force-translate")
    .addEventListener("click", async () => {
      const text = qInput.value.trim();
      if (!text) {
        qInput.focus();
        return;
      }

      const icon = document.querySelector("#btn-force-translate span");
      icon.style.transition = "transform 0.5s";
      icon.style.transform = "rotate(360deg)";

      const lang = appSettings.targetLang || "ru";
      const translation = await translateText(text, lang);

      if (translation) {
        aInput.value = translation;

        answerManuallyEdited = false;
      }

      setTimeout(() => {
        icon.style.transform = "none";
      }, 500);
    });

  // 4. Окно подтверждения удаления
  document
    .getElementById("btn-confirm-cancel")
    .addEventListener("click", () => {
      closeModalAnimation("modal-confirm");
      confirmCallback = null;
    });

  document
    .querySelector("#modal-confirm .modal-backdrop")
    .addEventListener("click", () => {
      closeModalAnimation("modal-confirm");
    });

  document.getElementById("btn-confirm-ok").addEventListener("click", () => {
    if (confirmCallback) confirmCallback();
    closeModalAnimation("modal-confirm");
  });

  // 5. РЕЖИМ ОБУЧЕНИЯ

  document
    .getElementById("btn-exit-study")
    .addEventListener("click", async () => {
      await renderDeckList();
      showView("decks");
    });

  document.getElementById("btn-show-answer").addEventListener("click", () => {
    const answerFace = document.getElementById("study-answer-face");
    const btnShow = document.getElementById("btn-show-answer");
    const srsActions = document.getElementById("srs-actions");

    answerFace.classList.remove("hidden");
    answerFace.classList.add("anim-reveal");

    btnShow.classList.add("hidden");
    srsActions.classList.remove("hidden");
    srsActions.style.display = "flex";
  });

  document.querySelectorAll(".srs-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const grade = parseInt(e.currentTarget.dataset.grade);
      if (!isNaN(grade)) {
        handleSrsAnswer(grade);
      }
    });
  });

  // 6. НАСТРОЙКИ

  document.getElementById("btn-settings").addEventListener("click", () => {
    showView("settings");
  });

  document.getElementById("btn-back-settings").addEventListener("click", () => {
    showView("decks");

    appSettings.newCardsLimit =
      parseInt(document.getElementById("input-new-cards").value) || 20;
    appSettings.translateEnabled =
      document.getElementById("toggle-translate").checked;
    appSettings.targetLang = document.getElementById("select-lang").value;
    saveSettings();
    updateTranslateUI();
  });

  document
    .getElementById("toggle-dark-mode")
    .addEventListener("change", (e) => {
      toggleDarkMode(e.target.checked);
    });

  document.getElementById("btn-reset-all").addEventListener("click", () => {
    showConfirm(
      "Удалить ВСЕ данные?",
      "Это удалит все колоды и карточки. Отменить нельзя.",
      () => resetAllData(),
    );
  });

  // --- УПРАВЛЕНИЕ FSRS ---

  const btnOpenOpt = document.getElementById("btn-open-optimizer");
  if (btnOpenOpt) {
    btnOpenOpt.addEventListener("click", () => {
      showView("optimizer");
    });
  }

  const btnBackOpt = document.getElementById("btn-back-optimizer");
  if (btnBackOpt) {
    btnBackOpt.addEventListener("click", () => {
      showView("settings");
    });
  }

  const btnDlHistory = document.getElementById("btn-download-history-screen");
  if (btnDlHistory) {
    btnDlHistory.addEventListener("click", async () => {
      try {
        await exportHistoryForOptimizer();
        showAlert(
          "Файл готов",
          "История сохранена. Теперь загрузите её в Colab.",
          "download_done",
        );
      } catch (e) {
        showAlert("Пусто", "История повторений пока пуста.", "info");
      }
    });
  }

  document.getElementById("btn-back-settings").addEventListener("click", () => {
    showView("decks");

    appSettings.newCardsLimit =
      parseInt(document.getElementById("input-new-cards").value) || 20;
    appSettings.translateEnabled =
      document.getElementById("toggle-translate").checked;
    appSettings.targetLang = document.getElementById("select-lang").value;

    const wStr = document.getElementById("input-fsrs-weights").value;
    try {
      const wArr = wStr.split(",").map((n) => parseFloat(n));

      if (wArr.length === 19 && !wArr.some(isNaN)) {
        appSettings.fsrsWeights = wArr;
      }
    } catch (e) {
      console.error("Ошибка парсинга весов", e);
    }

    saveSettings();
    initFSRS();
    updateTranslateUI();
  });

  // --- ИМПОРТ / ЭКСПОРТ ---

  document
    .getElementById("btn-export-json")
    .addEventListener("click", async () => {
      try {
        await exportData();
        showAlert("Успех", "Файл бэкапа скачан", "download_done");
      } catch (e) {
        console.error(e);
        showAlert("Ошибка", "Не удалось создать бэкап", "error");
      }
    });

  document.getElementById("btn-import-json").addEventListener("click", () => {
    document.getElementById("file-input-json").click();
  });

  document
    .getElementById("file-input-json")
    .addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        await importJsonData(file);
        await renderDeckList();
        showAlert("Готово", "Колоды успешно восстановлены", "check_circle");
      } catch (err) {
        console.error(err);
        showAlert("Ошибка", "Неверный формат файла", "error");
      }
      e.target.value = "";
    });

  // --- МОДАЛКА СТАТИСТИКИ ---
  const closeStatsBtn = document.getElementById("btn-close-stats");
  const statsModal = document.getElementById("modal-card-info");

  if (closeStatsBtn && statsModal) {
    closeStatsBtn.addEventListener("click", () => {
      closeModalAnimation("modal-card-info");
    });

    const backdrop = statsModal.querySelector(".modal-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => {
        closeModalAnimation("modal-card-info");
      });
    }
  }

  const alertBtn = document.getElementById("btn-alert-ok");
  const newAlertBtn = alertBtn.cloneNode(true);
  alertBtn.parentNode.replaceChild(newAlertBtn, alertBtn);

  newAlertBtn.addEventListener("click", () => {
    const callback = alertCallback;
    alertCallback = null;

    closeModalAnimation("modal-alert");

    if (callback) callback();
  });
}

// --- ОТРИСОВКА СПИСКА КОЛОД ---

async function renderDeckList() {
  const container = document.getElementById("decks-list");
  const emptyState = document.getElementById("decks-empty");
  container.innerHTML = "";

  const decks = await dbApi.getDecks();
  if (decks.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  const now = new Date();

  for (const deck of decks) {
    const cards = await dbApi.getCardsByDeckId(deck.id);

    const newCount = cards.filter((c) => c.reps === 0).length;
    const dueCount = cards.filter(
      (c) => c.reps > 0 && new Date(c.due) <= now,
    ).length;

    const card = document.createElement("div");
    card.className = "card deck-card";
    card.innerHTML = `
      <div class="deck-header">
        <div class="deck-info">
          <span class="deck-name">${deck.name}</span>
          <div class="deck-badges">
            ${newCount > 0 ? `<span class="badge new">${newCount}</span>` : ""}
            ${dueCount > 0 ? `<span class="badge due">${dueCount}</span>` : ""}
          </div>
        </div>
        <button class="icon-btn btn-delete-deck"><span class="material-symbols-rounded">delete</span></button>
      </div>
      <div class="deck-controls">
        <button class="btn-small btn-add-quick">Добавить</button>
        <button class="btn-small btn-study">Учить</button>
      </div>
    `;

    card
      .querySelector(".deck-header")
      .addEventListener("click", () => openDeck(deck));
    card.querySelector(".btn-delete-deck").addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeleteDeck(deck.id);
    });
    card.querySelector(".btn-add-quick").addEventListener("click", (e) => {
      e.stopPropagation();
      openAddCardScreen(deck.id);
    });
    card.querySelector(".btn-study").addEventListener("click", (e) => {
      e.stopPropagation();
      startStudySession(deck.id);
    });

    container.appendChild(card);
  }
}

async function startStudySession(deckId) {
  const allCards = await dbApi.getCardsByDeckId(deckId);
  const now = new Date();

  const newCards = allCards.filter((c) => c.reps === 0);
  const dueCards = allCards.filter((c) => c.reps > 0 && new Date(c.due) <= now);

  const limit = appSettings.newCardsLimit || 20;
  const limitedNewCards = newCards.slice(0, limit);

  studyQueue = [...dueCards, ...limitedNewCards];

  studyQueue.sort(() => Math.random() - 0.5);

  if (studyQueue.length === 0) {
    showAlert(
      "На сегодня всё!",
      "Вы повторили все доступные карточки в этой колоде. Отдохните!",
      "celebration",
      () => showView("decks"),
    );
    return;
  }

  currentCardIndex = 0;
  showView("study");
  showNextCard();
}

function showNextCard(animateEntry = false) {
  const progressBar = document.getElementById("study-progress");

  if (currentCardIndex >= studyQueue.length) {
    const progressBar = document.getElementById("study-progress");
    progressBar.style.width = "100%";

    setTimeout(() => {
      showAlert(
        "Урок завершен!",
        "Вы отлично поработали.",
        "emoji_events",
        async () => {
          await renderDeckList();
          showView("decks");
        },
      );
    }, 300);
    return;
  }

  const progress = (currentCardIndex / studyQueue.length) * 100;
  progressBar.style.width = `${progress}%`;

  const card = studyQueue[currentCardIndex];
  const cardEl = document.getElementById("study-card");
  const answerFace = document.getElementById("study-answer-face");

  cardEl.classList.remove("anim-exit-left");
  cardEl.classList.remove("anim-enter-right");
  answerFace.classList.remove("anim-reveal");

  document.getElementById("study-question").textContent = card.question;
  document.getElementById("study-answer").textContent = card.answer;

  answerFace.classList.add("hidden");
  document.getElementById("btn-show-answer").classList.remove("hidden");

  const srsActions = document.getElementById("srs-actions");
  srsActions.classList.add("hidden");
  srsActions.style.display = "none";

  if (animateEntry) {
    cardEl.classList.add("anim-enter-right");
  }

  const f = fsrs();
  const now = new Date();
  const scheduling_cards = f.repeat(card, now);

  const gradeMap = { again: 1, hard: 2, good: 3, easy: 4 };
  const labelMap = {
    again: "Снова",
    hard: "Трудно",
    good: "Хорошо",
    easy: "Легко",
  };

  Object.keys(gradeMap).forEach((key) => {
    const btn = document.querySelector(`.srs-btn.${key}`);
    const gradeIndex = gradeMap[key];
    const prediction = scheduling_cards[gradeIndex].card;

    const timeText =
      typeof formatInterval === "function"
        ? formatInterval(now, prediction.due)
        : "...";

    btn.innerHTML = `
      <span class="srs-time">${timeText}</span>
      <span class="srs-label">${labelMap[key]}</span>
    `;
  });
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

async function openAddCardScreen(deckId, cardToEdit = null) {
  const activeView = document.querySelector(".view.active");
  if (activeView && activeView.id === "view-cards") {
    previousScreen = "cards";
  } else {
    previousScreen = "decks";
  }
  currentDeckId = deckId;

  await loadDeckSelectOptions(deckId);

  const title = document.getElementById("add-card-title");
  const qInput = document.getElementById("input-question");
  const aInput = document.getElementById("input-answer");

  qInput.value = "";
  aInput.value = "";

  const deckSelectGroup = document.getElementById("group-deck-select");
  if (isQuickAddMode) {
    deckSelectGroup.classList.remove("hidden");
  } else {
    deckSelectGroup.classList.add("hidden");
  }

  if (cardToEdit) {
    editingCardId = cardToEdit.id;
    title.textContent = "Редактирование";
    qInput.value = cardToEdit.question;
    aInput.value = cardToEdit.answer;

    answerManuallyEdited = true;
  } else {
    editingCardId = null;
    title.textContent = "Новая карточка";

    answerManuallyEdited = false;
  }

  showView("addCard");

  setTimeout(() => qInput.focus(), 50);
}

async function renderCardList(deckId) {
  const container = document.getElementById("cards-container");
  container.innerHTML = "";

  const cards = await dbApi.getCardsByDeckId(deckId);

  if (cards.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>Пусто</p></div>`;
    return;
  }

  cards.forEach((card) => {
    const cardEl = document.createElement("div");
    cardEl.className = "card";
    cardEl.innerHTML = `
      <div class="word-row">
        <div style="flex:1; padding-right: 8px;">
          <div class="word-main">${card.question}</div>
          <div class="word-sub">${card.answer}</div>
        </div>
        <div style="display:flex; align-items:center; gap: 0;">
           <button class="icon-btn btn-info-card" title="Инфо" style="color: var(--primary);">
              <span class="material-symbols-rounded" style="font-size: 20px;">info</span>
           </button>
           <button class="icon-btn btn-edit-card" title="Изменить" style="color: var(--text-secondary);">
              <span class="material-symbols-rounded" style="font-size: 20px;">edit</span>
           </button>
           <button class="icon-btn btn-delete-card" title="Удалить">
              <span class="material-symbols-rounded" style="font-size: 20px;">close</span>
           </button>
        </div>
      </div>
    `;

    cardEl.querySelector(".btn-edit-card").addEventListener("click", (e) => {
      e.stopPropagation();
      openAddCardScreen(deckId, card);
    });

    cardEl.querySelector(".btn-info-card").addEventListener("click", (e) => {
      e.stopPropagation();
      showCardStats(card);
    });

    cardEl.querySelector(".btn-delete-card").addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeleteCard(card.id);
    });

    container.appendChild(cardEl);
  });
}

async function handleCreateDeck() {
  const input = document.getElementById("input-deck-name");
  const name = input.value.trim();

  if (!name) return;

  try {
    await dbApi.addDeck(name);
    input.value = "";

    closeModalAnimation("modal-deck");

    await renderDeckList();
  } catch (err) {
    console.error("Ошибка создания колоды:", err);
    showAlert("Ошибка", "Не удалось создать колоду", "error");
  }
}

async function openDeck(deck) {
  currentDeckId = deck.id;
  document.getElementById("current-deck-title").textContent = deck.name;
  await renderCardList(deck.id);
  showView("cards");
}

async function handleSaveCard() {
  const question = document.getElementById("input-question").value.trim();
  const answer = document.getElementById("input-answer").value.trim();

  if (!question || !answer) {
    showAlert("Ошибка", "Заполните оба поля", "error");
    return;
  }

  let targetDeckId = currentDeckId;
  if (isQuickAddMode) {
    targetDeckId = document.getElementById("select-target-deck").value;
  }

  try {
    if (editingCardId) {
      const cards = await dbApi.getCardsByDeckId(targetDeckId);
      const oldCard = cards.find((c) => c.id === editingCardId);

      if (oldCard) {
        const updatedCard = { ...oldCard, question, answer };
        await dbApi.updateCard(updatedCard);
      }

      if (isQuickAddMode) {
        window.close();
      } else {
        showView("cards");
        renderCardList(targetDeckId);
      }
    } else {
      await dbApi.addCard(targetDeckId, question, answer);

      if (isQuickAddMode) {
        window.close();
        return;
      }

      document.getElementById("input-question").value = "";
      document.getElementById("input-answer").value = "";
      document.getElementById("input-question").focus();
      answerManuallyEdited = false;
    }
  } catch (err) {
    console.error(err);
    showAlert("Ошибка", "Не удалось сохранить", "error");
  }
}

function closeModal() {
  document.getElementById("modal-deck").classList.add("hidden");
}

function initFSRS() {
  const params = generatorParameters({
    request_retention: 0.95,
    maximum_interval: 365,
    w: appSettings.fsrsWeights,
  });
  f = fsrs(params);
}

function showConfirm(title, text, onConfirm) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-text").textContent = text;
  confirmCallback = onConfirm;
  document.getElementById("modal-confirm").classList.remove("hidden");
}

function handleDeleteDeck(id) {
  showConfirm("Удалить?", "Все данные пропадут.", async () => {
    await dbApi.deleteDeck(id);
    await renderDeckList();
    showView("decks");
  });
}

function handleDeleteCard(id) {
  showConfirm("Удалить?", "", async () => {
    await dbApi.deleteCard(id);
    await renderCardList(currentDeckId);
  });
}

function showAlert(title, text, icon = "info", onOk = null) {
  document.getElementById("alert-title").textContent = title;
  document.getElementById("alert-text").textContent = text;
  document.getElementById("alert-icon").textContent = icon;

  alertCallback = onOk;
  document.getElementById("modal-alert").classList.remove("hidden");
}

// --- ЛОГИКА НАСТРОЕК ---

function loadSettings() {
  const saved = localStorage.getItem("flashcards-settings");
  if (saved) {
    const parsed = JSON.parse(saved);
    Object.assign(appSettings, parsed);

    if (!appSettings.fsrsWeights) appSettings.fsrsWeights = defaultW;
  }

  if (appSettings.darkMode) document.body.classList.add("dark-theme");
  document.getElementById("toggle-dark-mode").checked = appSettings.darkMode;

  document.getElementById("input-new-cards").value = appSettings.newCardsLimit;
  document.getElementById("toggle-translate").checked =
    appSettings.translateEnabled;
  document.getElementById("select-lang").value = appSettings.targetLang;

  document.getElementById("input-fsrs-weights").value =
    appSettings.fsrsWeights.join(", ");

  updateTranslateUI();
  initFSRS();
}

function saveSettings() {
  localStorage.setItem("flashcards-settings", JSON.stringify(appSettings));
}

function toggleDarkMode(isDark) {
  appSettings.darkMode = isDark;
  if (isDark) {
    document.body.classList.add("dark-theme");
  } else {
    document.body.classList.remove("dark-theme");
  }
  saveSettings();
}

async function resetAllData() {
  const db = await dbApi.open();
  const tx = db.transaction(["decks", "cards"], "readwrite");
  tx.objectStore("decks").clear();
  tx.objectStore("cards").clear();

  tx.oncomplete = () => {
    showAlert(
      "Готово",
      "Все данные удалены. Начинаем с чистого листа.",
      "cleaning_services",
      () => {
        showView("decks");
        renderDeckList();
      },
    );
  };
}

function closeModalAnimation(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;

  el.classList.add("hiding");

  setTimeout(() => {
    el.classList.remove("hiding");
    el.classList.add("hidden");
  }, 230);
}

async function handleSrsAnswer(grade) {
  const card = studyQueue[currentCardIndex];
  const cardEl = document.getElementById("study-card");

  const now = new Date();
  const scheduling_cards = f.repeat(card, now);

  const { card: updatedCardFields, log: reviewLog } = scheduling_cards[grade];

  const updatedCard = { ...card, ...updatedCardFields };
  await dbApi.updateCard(updatedCard);

  const logToSave = {
    ...reviewLog,
    cardId: card.id,
    review: new Date().getTime(),
  };
  await dbApi.addReviewLog(logToSave);

  cardEl.classList.add("anim-exit-left");
  setTimeout(() => {
    currentCardIndex++;
    showNextCard(true);
  }, 250);
}

function showCardStats(card) {
  const content = document.getElementById("card-stats-content");
  if (!content) return;

  const states = [
    "New (Новая)",
    "Learning (Обучение)",
    "Review (Повторение)",
    "Relearning (Забыл)",
  ];
  const stateText = states[card.state] || "Unknown";

  const dateOptions = {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  };
  const dueText = new Date(card.due).toLocaleDateString("ru-RU", dateOptions);
  const createdText = new Date(card.createdAt).toLocaleDateString(
    "ru-RU",
    dateOptions,
  );

  content.innerHTML = `
    <div style="margin-bottom: 8px;"><strong>Q:</strong> ${card.question}</div>
    <div style="margin-bottom: 12px;"><strong>A:</strong> ${card.answer}</div>
    
    <div style="background: var(--bg-color); padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span style="color:var(--text-secondary)">Статус:</span>
        <strong>${stateText}</strong>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span style="color:var(--text-secondary)">Повторений:</span>
        <strong>${card.reps}</strong>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span style="color:var(--text-secondary)">Сложность (D):</span>
        <strong>${card.difficulty?.toFixed(2) || "0.00"}</strong>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span style="color:var(--text-secondary)">Стабильность (S):</span>
        <strong>${card.stability?.toFixed(2) || "0.00"} дн.</strong>
      </div>
       <div style="display:flex; justify-content:space-between; margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
        <span style="color:var(--text-secondary)">След. повтор:</span>
        <strong style="color:var(--primary)">${dueText}</strong>
      </div>
    </div>
    
    <div style="margin-top: 8px; font-size: 10px; color: var(--text-secondary); text-align: right;">
      Создано: ${createdText}
    </div>
  `;

  document.getElementById("modal-card-info").classList.remove("hidden");
}

function updateTranslateUI() {
  const indicator = document.getElementById("translation-indicator");
  if (!indicator) return;

  if (appSettings.translateEnabled) {
    indicator.textContent = `в ${appSettings.targetLang.toUpperCase()}`;
    indicator.classList.remove("hidden");
  } else {
    indicator.classList.add("hidden");
  }
}

async function handleRenameDeck(id, newName) {
  try {
    await dbApi.updateDeck(id, newName);
    document.getElementById("current-deck-title").textContent = newName;
    await renderDeckList();
  } catch (e) {
    console.error(e);
    showAlert("Ошибка", "Не удалось переименовать", "error");
  }
}

async function loadDeckSelectOptions(selectedDeckId = null) {
  const decks = await dbApi.getDecks();
  const select = document.getElementById("select-target-deck");
  select.innerHTML = "";

  if (decks.length === 0) {
    const inboxId = await dbApi.addDeck("Inbox");
    const opt = document.createElement("option");
    opt.value = inboxId;
    opt.textContent = "Inbox";
    select.appendChild(opt);
    return inboxId;
  }

  decks.forEach((deck) => {
    const opt = document.createElement("option");
    opt.value = deck.id;
    opt.textContent = deck.name;
    select.appendChild(opt);
  });

  if (selectedDeckId) {
    select.value = selectedDeckId;
  } else if (decks.length > 0) {
    select.value = decks[0].id;
  }

  return select.value;
}
