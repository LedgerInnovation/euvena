/**
 * Every piece of wording the wallet shows, as one typed shape. A language is a
 * value of this shape, so a missing translation is a type error at build
 * time, never a blank label on a device. Wording that takes values is a
 * function, so each language orders the sentence its own way.
 *
 * Messages from the codec itself (the reasons an element failed) are not
 * here: the wallet names the element in the user's language and keeps the
 * codec's detail as it is, the way an error code is kept.
 */

export const LANGUAGES = ["en", "de", "fr", "es", "it", "nl", "pl"] as const;

export type Language = (typeof LANGUAGES)[number];

/** Each language named in itself, for the choice list. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  nl: "Nederlands",
  pl: "Polski",
};

/** The elements of a payload, as a rejection or a review names them. */
export type ElementKey =
  | "serviceTag"
  | "version"
  | "charset"
  | "identification"
  | "bic"
  | "name"
  | "iban"
  | "amount"
  | "purpose"
  | "reference"
  | "text"
  | "information"
  | "payload"
  /** An element the wallet has no name for. */
  | "other";

/** Why an input was not read as a payment request. */
export type RejectionCode =
  | "empty"
  | "notPaymentInput"
  | "codeInvalid"
  | "paytoInvalid"
  | "paytoTooLong"
  | "paytoNot"
  | "paytoMalformed"
  | "paytoDamaged"
  | "paytoNotIban"
  | "paytoRepeatedOption"
  | "paytoInstruction"
  | "paytoUnknownOption"
  | "paytoNoName"
  | "paytoBadAmount"
  | "paytoNotEuro"
  | "linkNot"
  | "linkRetired"
  | "linkNoRequest"
  | "linkDamaged"
  | "linkInvalid";

/** Why a data file was refused. */
export type TransferRefusal = "notAnExport" | "newerExport" | "tooLarge" | "bookUnread";

export interface Dictionary {
  /** Names of things, reused across screens. */
  elements: Record<ElementKey, string>;
  /** The invoice-style rows beside a code. */
  rows: {
    payee: string;
    iban: string;
    bic: string;
    amount: string;
    purpose: string;
    reference: string;
    text: string;
    information: string;
    /** The amount row when the code leaves it to the payer. */
    payerDecides: string;
  };
  common: {
    cancel: string;
    save: string;
    saving: string;
    open: string;
    copy: string;
    copied: string;
    /** Accessibility: "Copy {what}". */
    copyOf: (what: string) => string;
    /** Accessibility: "{what} copied". */
    copiedOf: (what: string) => string;
    /** Accessibility: "Back to {where}". */
    backTo: (where: string) => string;
    /** The BIC hint on the code review and in the form, one rule. */
    bicRule: string;
  };
  tabs: { request: string; pay: string; history: string };
  /** Validation of a payee, as the form and the request screen say it. */
  payeeIssues: {
    enterName: string;
    enterIban: string;
    ibanChecks: string;
    bicRequired: string;
    bicShape: string;
    /** The name does not fit a payload: too long, or not one line. */
    nameShape: string;
    /** The amount typed on the request screen is out of range. */
    amountRange: string;
    /** The remittance text does not fit a payload. */
    textShape: string;
    /** The structured reference is not a creditor reference. */
    referenceShape: string;
    /** Everything is valid on its own but the payload is over 331 bytes. */
    requestTooLong: string;
    /** The encoder refused for a reason the wallet has no words for. */
    unencodable: string;
    /** Appended to a payee issue listed under the request form. */
    inPayeeSettings: string;
  };
  /** Why an input was not a payment request. Invalid ones name their elements. */
  rejections: Record<Exclude<RejectionCode, "codeInvalid" | "paytoInvalid">, string> & {
    codeInvalid: (elements: string[]) => string;
    paytoInvalid: (elements: string[]) => string;
    /** A code or link the codec faulted without naming an element. */
    codeNoRequest: string;
    paytoNoRequest: string;
  };
  request: {
    title: string;
    settings: string;
    paidTo: string;
    switchPayee: string;
    changePayee: string;
    switchPayeeA11y: string;
    changePayeeA11y: string;
    whoGetsPaid: string;
    whoGetsPaidHint: string;
    addNameAndIban: string;
    checkPayee: string;
    openPayeeSettings: string;
    amountLabel: string;
    payerDecides: string;
    amountA11y: string;
    addPurpose: string;
    addPurposeA11y: string;
    purposeLabel: string;
    kindText: string;
    kindReference: string;
    textPlaceholder: string;
    referencePlaceholder: string;
    textHint: string;
    referenceHint: string;
  };
  composed: {
    shareTitle: string;
    share: string;
    keep: string;
    kept: string;
    keepFailed: string;
    shareHint: string;
    sharedIsKept: string;
    showDetails: string;
    showDetailsA11y: string;
    whatTheCodeSays: string;
    /** "EPC069-12 version {v}, UTF-8, {n} of {max} bytes. QR version {q} of {qmax}, error correction {ec}." */
    figures: (values: {
      version: string;
      bytes: number;
      maxBytes: number;
      qrVersion: number;
      maxQrVersion: number;
      correction: string;
    }) => string;
    shareFailed: string;
    renderFailed: string;
  };
  scan: {
    title: string;
    reviewTitle: string;
    subtitle: string;
    reviewSubtitle: string;
    waiting: string;
    showNew: string;
    turnOnCamera: string;
    cameraOnlyHere: string;
    cameraOff: string;
    pointCamera: string;
    pasteLabel: string;
    pastePlaceholder: string;
    readPasted: string;
    reviewHint: string;
    readAnother: string;
    payIt: string;
    referenceWarning: string;
    openBankingApp: string;
    noHandler: string;
    copyInto: string;
    handoffHint: string;
    nothingRead: string;
    rejectionHint: string;
    tryAgain: string;
  };
  history: {
    title: string;
    subtitle: string;
    keptRequest: string;
    readFailed: string;
    markFailed: string;
    unreadable: string;
    nothingKept: string;
    nothingKeptHint: string;
    done: string;
    markDone: string;
    markOpen: string;
    markDoneA11y: string;
    markOpenA11y: string;
  };
  payees: {
    title: string;
    subtitle: string;
    active: string;
    use: string;
    /** Accessibility: "Build requests for {name}". */
    useA11y: (name: string) => string;
    edit: string;
    editA11y: (name: string) => string;
    add: string;
    limit: (limit: number) => string;
    useFailed: string;
  };
  payee: {
    addTitle: string;
    editTitle: string;
    subtitle: string;
    name: string;
    namePlaceholder: string;
    iban: string;
    ibanPlaceholder: string;
    bic: string;
    bicPlaceholder: string;
    saveFailed: string;
    removeFailed: string;
    nothingSent: string;
    remove: string;
    removing: string;
    removeAsk: string;
    removeAskDetail: string;
    keep: string;
    removeConfirm: string;
    readFailed: string;
  };
  settings: {
    title: string;
    payees: string;
    payeesHint: string;
    none: string;
    /** "{name} and {n} more" */
    andMore: (name: string, more: number) => string;
    appearance: string;
    system: string;
    light: string;
    dark: string;
    language: string;
    /** The device-language choice, naming what it resolves to. */
    deviceLanguage: (name: string) => string;
    yourData: string;
    yourDataHint: string;
    exportAction: string;
    importAction: string;
    exportFailed: string;
    importFailed: string;
    /** An appearance or language choice could not be written. */
    preferenceFailed: string;
    exportBlocked: string;
    refusals: Record<TransferRefusal, string>;
    nothingNew: string;
    /** "Added {what}." with what already joined. */
    added: (what: string) => string;
    alreadyHere: (what: string) => string;
    couldNotUse: (what: string) => string;
    historyNotWritten: string;
    payeesCount: (n: number) => string;
    requestsCount: (n: number) => string;
    /** Joins two counted halves: "{a} and {b}". */
    and: (a: string, b: string) => string;
    shareDialog: string;
    about: string;
    aboutText: string;
  };
}
