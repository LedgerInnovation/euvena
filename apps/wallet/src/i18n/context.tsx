import { createContext, useContext, type ReactNode } from "react";

import { DICTIONARIES, type Dictionary, type Locale } from "./index";

interface LocaleInForce extends Locale {
  strings: Dictionary;
}

const LocaleContext = createContext<LocaleInForce>({
  language: "en",
  tag: "en",
  strings: DICTIONARIES.en,
});

/** Puts the locale in force under the screens. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <LocaleContext.Provider value={{ ...locale, strings: DICTIONARIES[locale.language] }}>
      {children}
    </LocaleContext.Provider>
  );
}

/** The locale in force and its wording. */
export function useLocale(): LocaleInForce {
  return useContext(LocaleContext);
}

/** The wording in force. */
export function useStrings(): Dictionary {
  return useContext(LocaleContext).strings;
}
