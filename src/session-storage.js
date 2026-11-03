// Supabase accepts an async storage adapter. "Remember me" must select the
// durable native store before Supabase restores or refreshes its auth session.
// A previously saved explicit choice always wins over inferred storage type.
export function createRememberedSessionStorage({
  persistent,
  temporary,
  getRemember,
  onRestore = () => {},
  hasExplicitChoice = () => false,
  beforeRead = async () => {}
}) {
  let authKey = null;
  const trackKey = (key) => {
    if (/-auth-token$/.test(key)) authKey = key;
  };
  return {
    async getItem(key) {
      await beforeRead();
      trackKey(key);
      const [saved, transient] = await Promise.all([
        persistent.getItem(key), temporary.getItem(key)
      ]);
      if (getRemember()) {
        if (saved !== null) {
          if (/-auth-token$/.test(key)) onRestore(true);
          return saved;
        }
        if (transient !== null) {
          if (hasExplicitChoice()) {
            // A user who chose "Remember me" may have a legacy session in
            // sessionStorage. Move it before the browser destroys it.
            await persistent.setItem(key, transient);
            await temporary.removeItem(key);
            if (/-auth-token$/.test(key)) onRestore(true);
          } else if (/-auth-token$/.test(key)) {
            // An old opt-out is not silently turned into a durable session.
            onRestore(false);
          }
          return transient;
        }
        return null;
      }
      if (transient !== null) {
        if (/-auth-token$/.test(key)) onRestore(false);
        return transient;
      }
      // Backward-compatible recovery of a durable session created before
      // this setting existed. Explicit "off" never restores a durable token.
      if (saved !== null && !hasExplicitChoice()) {
        if (/-auth-token$/.test(key)) onRestore(true);
        return saved;
      }
      return null;
    },
    async setItem(key, value) {
      await beforeRead();
      trackKey(key);
      const remember = Boolean(getRemember());
      const preferred = remember ? persistent : temporary;
      const other = remember ? temporary : persistent;
      // Save before deleting the old copy so a write failure is recoverable.
      await preferred.setItem(key, value);
      await other.removeItem(key);
    },
    async removeItem(key) {
      await beforeRead();
      trackKey(key);
      await Promise.all([persistent.removeItem(key), temporary.removeItem(key)]);
    },
    async syncChoice() {
      await beforeRead();
      if (!authKey) return;
      const [saved, transient] = await Promise.all([
        persistent.getItem(authKey), temporary.getItem(authKey)
      ]);
      if (getRemember() && transient !== null) {
        await persistent.setItem(authKey, transient);
        await temporary.removeItem(authKey);
      } else if (!getRemember() && saved !== null) {
        await temporary.setItem(authKey, saved);
        await persistent.removeItem(authKey);
      }
    }
  };
}

// Native Preferences survives WebView destruction and OS process restarts.
// Migrate a legacy WebView token only after the durable write succeeds.
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
