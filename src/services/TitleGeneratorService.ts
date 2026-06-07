import { createLogger } from "../utils/Logger";
import { LoggingCategories } from "../utils/LoggingSchema";

const log = createLogger(LoggingCategories.TITLE_GENERATOR);

const MAX_TITLE_LENGTH = 60;
const IDEAL_WORD_COUNT = 8;
const MIN_TITLE_LENGTH = 10;
const FALLBACK_TITLE = "Untitled chat";

export class TitleGeneratorService {
  static generateTitle(message: string): string {
    if (!message || !message.trim()) {
      return FALLBACK_TITLE;
    }

    const cleaned = this.cleanMessage(message);

    if (!cleaned) {
      return FALLBACK_TITLE;
    }

    const keyPhrase = this.extractKeyPhrase(cleaned);
    const truncated = this.truncateTitle(keyPhrase);

    log.info("Generated session title", {
      originalLength: message.length,
      cleaned,
      keyPhrase,
      finalTitle: truncated,
    });

    return truncated || FALLBACK_TITLE;
  }

  private static cleanMessage(message: string): string {
    const withoutPrefixes = message
      .replace(/^(?:please|can you|help me|i need|i want|can you please)\s*/i, "")
      .replace(/^(?:implement|create|add|fix|update|refactor|remove|delete|change|modify)\s*/i, "");
    const withoutLeadingSymbols = withoutPrefixes.replace(/^[?!@]*\s*/, "");
    const onlyAlphanumeric = withoutLeadingSymbols.replace(/[^\w\s\-/@.]/g, "");
    return onlyAlphanumeric.replace(/\s+/g, " ").trim();
  }

  private static extractKeyPhrase(cleaned: string): string {
    const words = cleaned.split(" ");

    if (words.length <= IDEAL_WORD_COUNT) {
      return cleaned;
    }

    const truncatedWords = words.slice(0, IDEAL_WORD_COUNT);
    return truncatedWords.join(" ");
  }

  private static truncateTitle(title: string): string {
    if (title.length <= MAX_TITLE_LENGTH) {
      return title;
    }

    return title.slice(0, MAX_TITLE_LENGTH - 3).trim() + "...";
  }
}
