import type { Dictionary } from "./dictionary";

export const pl: Dictionary = {
  elements: {
    serviceTag: "znacznik usługi",
    version: "wersja formatu",
    charset: "zestaw znaków",
    identification: "kod identyfikacyjny",
    bic: "BIC",
    name: "nazwa odbiorcy",
    iban: "IBAN",
    amount: "kwota",
    purpose: "kod celu",
    reference: "referencja płatności",
    text: "tytuł przelewu",
    information: "wiersz informacyjny",
    payload: "ogólna struktura",
    other: "element",
  },
  rows: {
    payee: "Odbiorca",
    iban: "IBAN",
    bic: "BIC",
    amount: "Kwota",
    purpose: "Cel",
    reference: "Referencja",
    text: "Tytuł",
    information: "Informacja",
    payerDecides: "wpisuje płacący",
  },
  common: {
    cancel: "Anuluj",
    save: "Zapisz",
    saving: "Zapisywanie",
    open: "Otwórz",
    copy: "Kopiuj",
    copied: "Skopiowano",
    copyOf: (what) => `Kopiuj: ${what}`,
    copiedOf: (what) => `Skopiowano: ${what}`,
    backTo: (where) => `Wróć: ${where}`,
    bicRule:
      "Kody w wersji 002 pomijają BIC dla odbiorców z EOG. Pozostaje on obowiązkowy dla rachunków w krajach SEPA poza EOG.",
  },
  tabs: { request: "Poproś", pay: "Zapłać", history: "Historia" },
  payeeIssues: {
    enterName: "Wpisz nazwę odbiorcy",
    enterIban: "Wpisz IBAN",
    ibanChecks: "Cyfry kontrolne lub długość nie zgadzają się z ISO 13616",
    bicRequired: "Dla rachunków w krajach SEPA poza EOG wymagany jest BIC",
    bicShape: "BIC ma 8 lub 11 znaków: 6 liter, a potem litery lub cyfry",
    nameShape: "Do 70 widocznych znaków w jednym wierszu",
    amountRange: "Kwota musi mieścić się między 0,01 a 999999999,99 euro",
    textShape: "Do 140 widocznych znaków w jednym wierszu",
    referenceShape: "Referencja wierzyciela zaczyna się od RF, ma poprawne cyfry kontrolne i do 35 znaków",
    requestTooLong: "Żądanie nie mieści się w kodzie. Skróć tekst.",
    unencodable: "Nie udało się zakodować żądania.",
    inPayeeSettings: "(ustawienia odbiorcy)",
  },
  rejections: {
    empty: "Nie ma nic do odczytania.",
    notPaymentInput: "To nie jest kod płatności ani udostępniony link do płatności.",
    codeInvalid: (elements) =>
      `Kod nie jest prawidłowym żądaniem płatności. Bez pozytywnej kontroli: ${joinList(elements)}.`,
    paytoInvalid: (elements) =>
      `Link payto nie jest prawidłowym żądaniem płatności. Bez pozytywnej kontroli: ${joinList(elements)}.`,
    codeNoRequest: "Kod nie zawiera prawidłowego żądania płatności.",
    paytoNoRequest: "Link payto nie zawiera prawidłowego żądania płatności.",
    paytoTooLong: "Link payto zawiera więcej tekstu, niż mieści kod płatności.",
    paytoNot: "To nie jest link payto.",
    paytoMalformed: "Link payto jest źle zbudowany.",
    paytoDamaged: "Link payto jest uszkodzony i nie można go odczytać.",
    paytoNotIban: "Link payto dotyczy innego typu rachunku niż IBAN.",
    paytoRepeatedOption: "Link payto powtarza opcję.",
    paytoInstruction:
      "Link payto zawiera identyfikator end-to-end, którego ta aplikacja nie może przekazać.",
    paytoUnknownOption: "Link payto zawiera opcję, której ta aplikacja nie zna.",
    paytoNoName: "Link payto nie wskazuje odbiorcy.",
    paytoBadAmount: "Link payto zawiera kwotę, której ta aplikacja nie może użyć.",
    paytoNotEuro: "Link payto żąda innej waluty niż euro.",
    linkNot: "To nie jest link euvena://request.",
    linkRetired:
      "Ten link udostępniono, zanim aplikacja zmieniła nazwę na Euvena. Poproś o nowy link lub kod.",
    linkNoRequest: "Link nie zawiera żądania płatności.",
    linkDamaged: "Link jest uszkodzony i nie można go odczytać.",
    linkInvalid: "Link nie zawiera prawidłowego żądania płatności.",
  },
  request: {
    title: "Poproś o pieniądze",
    settings: "Ustawienia",
    paidTo: "Płatność dla",
    switchPayee: "Zmień",
    changePayee: "Edytuj",
    switchPayeeA11y: "Zmień odbiorcę",
    changePayeeA11y: "Edytuj odbiorcę",
    whoGetsPaid: "Kto otrzyma płatność?",
    whoGetsPaidHint:
      "Dodaj nazwę i IBAN, na które ma trafić płatność. Zostają na tym urządzeniu: aplikacja nie ma kont ani serwera.",
    addNameAndIban: "Dodaj nazwę i IBAN",
    checkPayee: "Sprawdź ustawienia odbiorcy",
    openPayeeSettings: "Otwórz ustawienia odbiorcy",
    amountLabel: "Kwota w euro",
    payerDecides: "Decyduje płacący",
    amountA11y: "Kwota w euro, zostaw puste, aby płacący zdecydował",
    addPurpose: "Dodaj tytuł",
    addPurposeA11y: "Dodaj tytuł płatności, tekst lub referencję",
    purposeLabel: "Tytuł",
    kindText: "Tekst",
    kindReference: "Referencja",
    textPlaceholder: "Za co jest płatność",
    referencePlaceholder: "RF18539007547034",
    textHint: "Do 140 znaków tekstu",
    referenceHint: "Ustrukturyzowana referencja wierzyciela, do 35 znaków",
  },
  composed: {
    shareTitle: "Żądanie płatności",
    share: "Udostępnij to żądanie",
    keep: "Zachowaj bez udostępniania",
    kept: "Zachowano w historii",
    keepFailed: "Nie udało się zachować żądania na tym urządzeniu.",
    shareHint: "Link zawiera to samo żądanie co kod.",
    sharedIsKept: "Udostępnione żądanie jest zachowywane w historii.",
    showDetails: "Pokaż, co mówi kod",
    showDetailsA11y: "Pokaż, co mówi kod, wartości z niego odczytane",
    whatTheCodeSays: "Co mówi kod",
    figures: ({ version, bytes, maxBytes, qrVersion, maxQrVersion, correction }) =>
      `EPC069-12 wersja ${version}, UTF-8, ${bytes} z ${maxBytes} bajtów. Wersja QR ${qrVersion} z ${maxQrVersion}, korekcja błędów ${correction}.`,
    shareFailed: "Nie udało się udostępnić żądania.",
    renderFailed: "Nie udało się narysować kodu.",
  },
  scan: {
    title: "Zapłać żądanie",
    reviewTitle: "Sprawdź żądanie",
    subtitle: "Odczytaj kod lub udostępnione żądanie. Odczyt niczego nie płaci ani nie wysyła.",
    reviewSubtitle:
      "Nic jeszcze nie zapłacono ani nie wysłano. Przekazanie do aplikacji bankowej czeka na Ciebie.",
    waiting: "Otwarto inne żądanie. Poniżej nadal jest to, które oglądasz.",
    showNew: "Pokaż nowe żądanie",
    turnOnCamera: "Włącz aparat",
    cameraOnlyHere: "Aparat służy tylko do odczytu kodów na tym ekranie.",
    cameraOff:
      "Aparat jest wyłączony dla tej aplikacji w ustawieniach systemu. Wklejanie poniżej nadal działa.",
    pointCamera: "Skieruj aparat na kod QR płatności.",
    pasteLabel: "Lub wklej żądanie",
    pastePlaceholder: "Link euvena:// lub payto://, albo tekst kodu",
    readPasted: "Odczytaj wklejone",
    reviewHint:
      "Wartości odczytane z samego kodu. Sprawdź nazwę i IBAN u osoby, która prosi o płatność; kod nie zrobi tego za Ciebie.",
    readAnother: "Odczytaj kolejny",
    payIt: "Zapłać",
    referenceWarning:
      "Link nie może przenieść ustrukturyzowanej referencji. Najpierw ją skopiuj i wklej w pole referencji w aplikacji bankowej.",
    openBankingApp: "Otwórz aplikację bankową",
    noHandler:
      "Żadna zainstalowana aplikacja nie przyjęła tego żądania. Banki nie uzgodniły jeszcze wspólnego formatu linku, więc skopiuj dane do aplikacji bankowej.",
    copyInto: "Skopiuj do formularza przelewu",
    handoffHint:
      "Link to adres payto zbudowany z kodu. Jeśli żadna aplikacja na tym urządzeniu nie odpowie, Twoja aplikacja bankowa może i tak skanować te kody bezpośrednio.",
    nothingRead: "Nie odczytano nic użytecznego",
    rejectionHint:
      "Żądanie, które nie przejdzie kontroli, nie jest w ogóle pokazywane: częściowy odczyt mógłby skierować pieniądze na niewłaściwy rachunek.",
    tryAgain: "Spróbuj ponownie",
  },
  history: {
    title: "Historia",
    subtitle:
      "Żądania zachowane na tym urządzeniu, od najnowszego. Oznaczenie jako załatwione to Twoja własna notatka.",
    keptRequest: "Zachowane żądanie",
    readFailed:
      "Nie udało się odczytać zapisanej historii na tym urządzeniu. Do ponownego uruchomienia aplikacji nic nie jest zachowywane ani oznaczane, aby nie nadpisać zapisanej listy.",
    markFailed: "Nie udało się zapisać oznaczenia na tym urządzeniu.",
    unreadable: "Nie udało się odczytać tego wpisu jako żądania płatności.",
    nothingKept: "Jeszcze nic nie zachowano",
    nothingKeptHint:
      "Żądanie trafia tutaj, gdy je udostępnisz lub gdy naciśniesz Zachowaj bez udostępniania.",
    done: "załatwione",
    markDone: "Oznacz jako załatwione",
    markOpen: "Oznacz jako otwarte",
    markDoneA11y: "Oznacz to żądanie jako załatwione",
    markOpenA11y: "Oznacz to żądanie ponownie jako otwarte",
  },
  payees: {
    title: "Odbiorcy",
    subtitle:
      "Żądania są tworzone dla aktywnego odbiorcy. Wszyscy zostają na tym urządzeniu.",
    active: "Aktywny",
    use: "Użyj",
    useA11y: (name) => `Twórz żądania dla: ${name}`,
    edit: "Edytuj",
    editA11y: (name) => `Edytuj: ${name}`,
    add: "Dodaj odbiorcę",
    limit: (limit) => `Aplikacja przechowuje do ${limit} odbiorców.`,
    useFailed: "Nie udało się zapisać wyboru na tym urządzeniu.",
  },
  payee: {
    addTitle: "Dodaj odbiorcę",
    editTitle: "Edytuj odbiorcę",
    subtitle:
      "Przechowywane tylko na tym urządzeniu. Aplikacja nie ma kont ani serwera i nigdy nie przekazuje środków.",
    name: "Nazwa",
    namePlaceholder: "Nazwa odbiorcy, do 70 znaków",
    iban: "IBAN",
    ibanPlaceholder: "PL61 1090 1014 0000 0712 1981 2874",
    bic: "BIC",
    bicPlaceholder: "Opcjonalny w EOG",
    saveFailed: "Nie udało się zapisać ustawień na tym urządzeniu. Nic nie zostało zapisane.",
    removeFailed: "Nie udało się usunąć odbiorcy z tego urządzenia.",
    nothingSent: "Nic nie jest nigdzie wysyłane. Dane trafiają tylko do kodów, które tworzysz.",
    remove: "Usuń tego odbiorcę",
    removing: "Usuwanie",
    removeAsk: "Usunąć tego odbiorcę?",
    removeAskDetail: "Jego nazwa i IBAN nie są przechowywane nigdzie indziej.",
    keep: "Zachowaj",
    removeConfirm: "Usuń",
    readFailed:
      "Nie udało się odczytać zapisanych ustawień na tym urządzeniu. Wpisz je ponownie, aby utworzyć kod.",
  },
  settings: {
    title: "Ustawienia",
    payees: "Odbiorcy",
    payeesHint: "Komu są płacone żądania. Przechowywane tylko na tym urządzeniu.",
    none: "Jeszcze brak",
    andMore: (name, more) => `${name} i jeszcze ${more}`,
    appearance: "Wygląd",
    system: "Systemowy",
    light: "Jasny",
    dark: "Ciemny",
    language: "Język",
    deviceLanguage: (name) => `Język urządzenia (${name})`,
    yourData: "Twoje dane",
    yourDataHint:
      "Odbiorcy i zachowane żądania jako jeden plik. Eksport przekazuje go do arkusza udostępniania; import dodaje zawartość pliku do tego, co jest tutaj, i niczego nie zastępuje.",
    exportAction: "Eksportuj do pliku",
    importAction: "Importuj z pliku",
    exportFailed: "Nie udało się wyeksportować danych.",
    importFailed: "Nie udało się zaimportować pliku.",
    preferenceFailed: "Nie udało się zapisać wyboru na tym urządzeniu.",
    exportBlocked:
      "Nie udało się odczytać zapisanych danych na tym urządzeniu, więc nie ma nic kompletnego do wyeksportowania.",
    refusals: {
      notAnExport: "Ten plik nie jest eksportem z aplikacji Euvena.",
      newerExport:
        "Ten plik zapisała nowsza wersja aplikacji. Zaktualizuj aplikację, aby go odczytać.",
      tooLarge: "Ten plik jest większy niż jakikolwiek eksport z aplikacji.",
      bookUnread:
        "Nie udało się odczytać zapisanych odbiorców na tym urządzeniu, więc nie można dodać do nich pliku.",
    },
    nothingNew: "Nic nowego w tym pliku.",
    added: (what) => `Dodano: ${what}.`,
    alreadyHere: (what) => `Już obecne lub ponad limit: ${what}.`,
    couldNotUse: (what) => `Nie do użycia: ${what}.`,
    historyNotWritten: "Nie udało się zapisać zachowanych żądań na tym urządzeniu.",
    payeesCount: (n) => `${n} ${pluralPl(n, "odbiorca", "odbiorców", "odbiorców")}`,
    requestsCount: (n) => `${n} ${pluralPl(n, "żądanie", "żądania", "żądań")}`,
    and: (a, b) => `${a} i ${b}`,
    shareDialog: "Zapisz lub wyślij dane aplikacji",
    about: "O aplikacji",
    aboutText:
      "Euvena to referencyjna aplikacja do kodów płatności EPC069-12. Nie ma kont ani serwera i nigdy nie przenosi pieniędzy: żądanie jest przekazywane do Twojej aplikacji bankowej.",
  },
};

/** Polish counts take three forms: one, a few (2 to 4 outside the teens) and many. */
function pluralPl(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const last = n % 10;
  const tens = n % 100;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

function joinList(items: string[]): string {
  const last = items[items.length - 1] ?? "";
  if (items.length <= 1) return last;
  return `${items.slice(0, -1).join(", ")} i ${last}`;
}
