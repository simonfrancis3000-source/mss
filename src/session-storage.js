// Supabase accepts an async storage adapter. Keep persistence independent of
// reading a token so an older read cannot undo a new checkbox selection.
export function createRememberedSessionStorage({ persistent, temporary, getRemember, onRestore = () => {} }) {
  return {
    async getItem(key) {
      const [saved, transient] = await Promise.all([persistent.getItem(key), temporary.getItem(key)]);
      const usePersistent = saved !== null && (getRemember() || transient === null);
      const value = usePersistent ? saved : transient;
      if (value !== null && /-auth-token$/.test(key)) onRestore(usePersistent);
      return value;
    },
    async setItem(key, value) {
      const remember = getRemember();
      const preferred = remember ? persistent : temporary;
      const other = remember ? temporary : persistent;
      // Do not destroy a recoverable session if its replacement cannot be saved.
      await preferred.setItem(key, value);
      await other.removeItem(key);
    },
    async removeItem(key) {
      await Promise.all([persistent.removeItem(key), temporary.removeItem(key)]);
    }
  };
}

export function nativePersistentSessionStorage(preferences, legacyStorage) {
  return {
    async getItem(key) {
      const { value } = await preferences.get({ key });
      if (value !== null) return value;
      const legacy = legacyStorage.getItem(key);
      if (legacy !== null) {
        await preferences.set({ key, value: legacy });
        legacyStorage.removeItem(key);
      }
      return legacy;
    },
    async setItem(key, value) {
      await preferences.set({ key, value });
      legacyStorage.removeItem(key);
    },
    async removeItem(key) {
      await preferences.remove({ key });
      legacyStorage.removeItem(key);
    }
  };
}
