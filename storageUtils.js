import { dbApi } from "./db.js";

export async function exportData() {
  const decks = await dbApi.getDecks();
  const allCards = [];

  for (const deck of decks) {
    const cards = await dbApi.getCardsByDeckId(deck.id);
    allCards.push(...cards);
  }

  const backup = {
    version: 1,
    date: new Date().toISOString(),
    decks,
    cards: allCards,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `flashcards_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function importJsonData(file) {
  const text = await file.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("Файл поврежден или не является JSON");
  }

  if (!data.decks || !data.cards) {
    throw new Error("Неверный формат файла бэкапа");
  }

  for (const deck of data.decks) {
    const newDeckId = await dbApi.addDeck(deck.name + " (Import)");

    const deckCards = data.cards.filter((c) => c.deckId === deck.id);

    for (const card of deckCards) {
      await dbApi.addCardFull(newDeckId, card);
    }
  }
}

export async function exportHistoryForOptimizer() {
  const revlog = await dbApi.getAllRevlog();

  if (revlog.length === 0) {
    throw new Error("История пуста.");
  }

  revlog.sort((a, b) => a.review - b.review);

  let csvContent =
    "card_id,review_time,review_rating,review_state,review_duration\n";

  revlog.forEach((log) => {
    let rating = log.rating;
    if (rating === undefined) rating = log.grade;

    let duration = log.duration || 0;

    csvContent += `${log.cardId},${log.review},${rating},${log.state},${duration}\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `lambdacards_raw_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
