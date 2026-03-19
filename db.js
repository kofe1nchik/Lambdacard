const DB_NAME = "flashcardsDB";
const DB_VERSION = 3;

let dbInstance = null;

export const dbApi = {
  open: () => {
    return new Promise((resolve, reject) => {
      if (dbInstance) return resolve(dbInstance);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains("decks")) {
          db.createObjectStore("decks", { keyPath: "id", autoIncrement: true });
        }

        if (!db.objectStoreNames.contains("cards")) {
          const store = db.createObjectStore("cards", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("deckId", "deckId", { unique: false });
          store.createIndex("due", "due", { unique: false });
        } else {
          const store = request.transaction.objectStore("cards");
          if (!store.indexNames.contains("due"))
            store.createIndex("due", "due", { unique: false });
        }

        if (!db.objectStoreNames.contains("revlog")) {
          const store = db.createObjectStore("revlog", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("review", "review", { unique: false });
        }
      };

      request.onsuccess = (e) => {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  addDeck: async (name) => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const request = tx
        .objectStore("decks")
        .add({ name, createdAt: Date.now() });
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  },

  getDecks: async () => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readonly");
      tx.objectStore("decks").getAll().onsuccess = (e) =>
        resolve(e.target.result);
    });
  },

  deleteDeck: async (id) => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["decks", "cards", "revlog"], "readwrite");
      tx.objectStore("decks").delete(id);
      const cardStore = tx.objectStore("cards");
      const index = cardStore.index("deckId");
      index.openCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
    });
  },

  updateDeck: async (id, newName) => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const store = tx.objectStore("decks");
      
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const data = getRequest.result;
        if (data) {
          data.name = newName; 
          store.put(data);    
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  getOrCreateDefaultDeck: async () => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const store = tx.objectStore("decks");
      const request = store.getAll();
      request.onsuccess = () => {
        const decks = request.result;
        if (decks.length > 0) resolve(decks[decks.length - 1].id);
        else {
          const addReq = store.add({ name: "Inbox", createdAt: Date.now() });
          addReq.onsuccess = () => resolve(addReq.result);
        }
      };
      request.onerror = () => reject(request.error);
    });
  },

  addDeck: async (name) => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const request = tx
        .objectStore("decks")
        .add({ name, createdAt: Date.now() });
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  getDecks: async () => {
    const db = await dbApi.open();
    return new Promise((resolve) => {
      const tx = db.transaction("decks", "readonly");
      tx.objectStore("decks").getAll().onsuccess = (e) =>
        resolve(e.target.result);
    });
  },
  deleteDeck: async (id) => {
    const db = await dbApi.open();
    return new Promise((resolve) => {
      const tx = db.transaction(["decks", "cards", "revlog"], "readwrite");
      tx.objectStore("decks").delete(id);
      const index = tx.objectStore("cards").index("deckId");
      index.openCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
    });
  },
  getOrCreateDefaultDeck: async () => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("decks", "readwrite");
      const store = tx.objectStore("decks");
      store.getAll().onsuccess = (e) => {
        const decks = e.target.result;
        if (decks.length > 0) resolve(decks[decks.length - 1].id);
        else
          store.add({ name: "Inbox", createdAt: Date.now() }).onsuccess = (
            e2,
          ) => resolve(e2.target.result);
      };
    });
  },
  addCard: async (deckId, question, answer) => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cards", "readwrite");
      const card = {
        deckId: Number(deckId),
        question,
        answer,
        due: Date.now(),
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 0,
        state: 0,
        last_review: null,
        createdAt: Date.now(),
      };
      tx.objectStore("cards").add(card).onsuccess = (e) =>
        resolve(e.target.result);
    });
  },
  addCardFull: async (deckId, cardData) => {
    const db = await dbApi.open();
    return new Promise((resolve) => {
      const tx = db.transaction("cards", "readwrite");
      const { id, ...data } = cardData;
      tx.objectStore("cards").add({ ...data, deckId: Number(deckId) });
      tx.oncomplete = () => resolve();
    });
  },
  getCardsByDeckId: async (deckId) => {
    const db = await dbApi.open();
    return new Promise((resolve) => {
      const tx = db.transaction("cards", "readonly");
      tx
        .objectStore("cards")
        .index("deckId")
        .getAll(IDBKeyRange.only(Number(deckId))).onsuccess = (e) =>
        resolve(e.target.result);
    });
  },
  updateCard: async (card) => {
    const db = await dbApi.open();
    return new Promise((resolve) => {
      const tx = db.transaction("cards", "readwrite");
      tx.objectStore("cards").put(card);
      tx.oncomplete = () => resolve();
    });
  },
  deleteCard: async (id) => {
    const db = await dbApi.open();
    return new Promise((resolve) => {
      const tx = db.transaction("cards", "readwrite");
      tx.objectStore("cards").delete(id);
      tx.oncomplete = () => resolve();
    });
  },

  addReviewLog: async (logData) => {
    const db = await dbApi.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("revlog", "readwrite");
      tx.objectStore("revlog").add(logData);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  getAllRevlog: async () => {
    const db = await dbApi.open();
    return new Promise((resolve) => {
      const tx = db.transaction("revlog", "readonly");
      tx.objectStore("revlog").getAll().onsuccess = (e) =>
        resolve(e.target.result);
    });
  },

  getReviewCount: async () => {
    const db = await dbApi.open();
    return new Promise((resolve) => {
      const tx = db.transaction("revlog", "readonly");
      const countReq = tx.objectStore("revlog").count();
      countReq.onsuccess = () => resolve(countReq.result);
    });
  },
};
