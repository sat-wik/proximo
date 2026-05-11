"""
Curate the dictionary and target pool.

Run from the project root:
    python packages/embeddings/scripts/curate-words.py

Outputs:
    data/dictionary.json   — 20,000 guessable words, frequency-ordered
    data/targets.json      — ~3,000 common English nouns

Strategy:
  - Dictionary: top 20k words from wordfreq, minus pure function words.
    Players can guess anything recognizable, so we keep nouns, verbs, and
    adjectives — just strip determiners, pronouns, prepositions, and modals.
  - Targets: WordNet nouns cross-referenced with wordfreq frequency scores.
    Nouns make the best targets: concrete, unambiguous, familiar.
    Sorted by frequency, filtered to a familiar-but-not-trivial sweet spot.
"""

import json
import os
import sys

try:
    from wordfreq import top_n_list, word_frequency
except ImportError:
    sys.exit("Missing: pip install wordfreq")

try:
    import nltk
    from nltk.corpus import wordnet
except ImportError:
    sys.exit("Missing: pip install nltk")

# ---------------------------------------------------------------------------
# Download WordNet if not already present
# ---------------------------------------------------------------------------
def ensure_wordnet():
    try:
        wordnet.synsets("test")
    except LookupError:
        print("Downloading NLTK WordNet data...")
        nltk.download("wordnet", quiet=True)
        nltk.download("omw-1.4", quiet=True)

# ---------------------------------------------------------------------------
# Function words — purely grammatical, never good guesses
# ---------------------------------------------------------------------------
FUNCTION_WORDS = {
    "the", "a", "an", "this", "that", "these", "those", "each", "every",
    "either", "neither", "both", "all", "any", "some", "few", "many",
    "much", "more", "most", "other", "another", "such", "what", "which",
    "whose", "whatever", "whichever", "whoever",
    "i", "me", "my", "myself", "we", "us", "our", "ours", "ourselves",
    "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself", "she", "her", "hers", "herself",
    "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
    "one", "ones", "who", "whom", "whoever", "whomever",
    "be", "am", "is", "are", "was", "were", "been", "being",
    "have", "has", "had", "having", "do", "does", "did", "done", "doing",
    "will", "would", "shall", "should", "may", "might", "must",
    "can", "could", "ought", "dare", "need",
    "in", "on", "at", "by", "for", "with", "about", "against", "between",
    "into", "through", "during", "before", "after", "above", "below",
    "from", "up", "down", "out", "off", "over", "under", "again",
    "further", "then", "once", "here", "there", "across", "along",
    "around", "behind", "beside", "besides", "beyond", "except", "inside",
    "near", "outside", "past", "per", "plus", "since", "throughout",
    "toward", "towards", "underneath", "until", "unto", "upon", "via",
    "within", "without", "worth",
    "and", "but", "or", "nor", "so", "yet",
    "although", "because", "since", "unless", "until", "while", "though",
    "even", "whether", "whereas", "whereby",
    "very", "too", "quite", "rather", "just", "only", "also", "still",
    "already", "soon", "now", "then", "always", "never", "ever",
    "often", "usually", "sometimes", "perhaps", "maybe", "probably",
    "certainly", "definitely", "really", "almost", "enough", "else",
    "however", "therefore", "thus", "hence", "otherwise", "instead",
    "meanwhile", "nevertheless", "nonetheless", "furthermore", "moreover",
    "accordingly", "consequently", "subsequently",
    "said", "says", "okay", "ok", "yeah", "yes", "no",
    "well", "like", "just", "get", "got", "been",
    "than", "when", "own", "same", "ago", "way", "away", "back",
    # Interrogatives and negation
    "not", "how", "where", "why", "whom",
    # Common adjectives used purely as modifiers (bad guesses, too generic)
    "good", "bad", "new", "old", "big", "small", "long", "short",
    "high", "low", "great", "little", "large", "right", "left",
    "next", "last", "first", "second", "third",
    "many", "much", "few", "several", "certain", "whole", "main",
}

PROFANITY = {
    "shit", "fuck", "fucking", "fucker", "cunt", "cock", "dick", "ass",
    "arse", "bitch", "damn", "piss", "crap", "slut", "twat", "wank",
    "prick", "turd", "douche", "bastard", "asshole", "bullshit",
    "shitty", "pussy",
}


def is_valid_dictionary_word(word: str) -> bool:
    if word in FUNCTION_WORDS or word in PROFANITY:
        return False
    if not (3 <= len(word) <= 14):
        return False
    if not word.isalpha() or word != word.lower():
        return False
    return True


def get_wordnet_nouns() -> set[str]:
    """Return words whose PRIMARY (most frequent) WordNet sense is a noun.

    wordnet.synsets(w) returns synsets ordered by usage frequency, so
    checking synsets(w)[0].pos() == 'n' ensures the word is primarily a noun,
    not an adjective or verb that can be used nominally ('general', 'local').
    """
    # Collect candidates: any word appearing in at least one noun synset
    candidates: set[str] = set()
    for synset in wordnet.all_synsets("n"):
        for lemma in synset.lemmas():
            w = lemma.name().lower()
            if w.isalpha() and "_" not in w:
                candidates.add(w)

    # Keep only those whose primary sense is noun
    primary_nouns: set[str] = set()
    for w in candidates:
        synsets = wordnet.synsets(w)
        if synsets and synsets[0].pos() == "n":
            primary_nouns.add(w)
    return primary_nouns


# Proper nouns and proper-noun-adjacent words that leak into WordNet
PROPER_NOUN_BLOCKLIST = {
    # Days / months
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "june", "july", "august",
    "september", "october", "november", "december",
    # Common first names
    "michael", "david", "james", "john", "robert", "william", "richard",
    "joseph", "charles", "thomas", "christopher", "daniel", "matthew",
    "anthony", "donald", "mark", "paul", "steven", "andrew", "kenneth",
    "george", "joshua", "kevin", "brian", "edward", "ronald", "timothy",
    "jason", "jeffrey", "ryan", "jacob", "gary", "nicholas", "eric",
    "jonathan", "stephen", "larry", "justin", "scott", "brandon", "frank",
    "benjamin", "raymond", "gregory", "samuel", "patrick", "alexander",
    "jack", "dennis", "jerry", "tyler", "aaron", "henry", "douglas",
    "peter", "adam", "nathan", "zachary", "walter", "harold", "kyle",
    "mary", "patricia", "jennifer", "linda", "barbara", "elizabeth",
    "susan", "jessica", "sarah", "karen", "lisa", "nancy", "betty",
    "margaret", "sandra", "ashley", "emily", "dorothy", "melissa",
    "deborah", "stephanie", "rebecca", "sharon", "laura", "cynthia",
    "kathleen", "amy", "shirley", "angela", "helen", "anna", "brenda",
    "pamela", "emma", "nicole", "samantha", "katherine", "rachel",
    "carolyn", "virginia", "maria", "heather", "diane", "julie", "joyce",
    "victoria", "olivia", "kelly", "joan", "alice", "judy", "martha",
    "grace", "beverly", "claire", "hillary", "hamilton", "jeff", "earl",
    "andy", "brad", "chad", "todd", "hong", "ann", "sue", "kim",
    # Countries, cities, places
    "france", "england", "germany", "spain", "russia", "china", "japan",
    "india", "canada", "australia", "mexico", "brazil", "korea", "iran",
    "iraq", "egypt", "israel", "turkey", "ukraine", "poland", "sweden",
    "norway", "denmark", "finland", "austria", "belgium", "portugal",
    "greece", "switzerland", "netherlands", "argentina", "colombia",
    "chile", "peru", "venezuela", "nigeria", "kenya", "ethiopia", "ghana",
    "morocco", "algeria", "pakistan", "indonesia", "thailand", "vietnam",
    "london", "paris", "berlin", "madrid", "rome", "moscow", "beijing",
    "tokyo", "delhi", "sydney", "toronto", "chicago", "houston", "phoenix",
    "seattle", "boston", "denver", "atlanta", "miami", "dallas", "detroit",
    "brooklyn", "manhattan", "orleans", "angeles", "francisco", "diego",
    "minnesota", "colorado", "california", "florida", "texas", "illinois",
    "michigan", "ohio", "georgia", "virginia", "carolina", "dakota",
    "tennessee", "alabama", "indiana", "kentucky", "louisiana", "oklahoma",
    "nevada", "hawaii", "alaska", "oregon", "maryland", "connecticut",
    # Brands
    "netflix", "google", "twitter", "amazon", "disney", "microsoft",
    "facebook", "instagram", "youtube", "harvard", "oxford", "stanford",
    # Controversial terms (legitimate words but poor game targets)
    "isis", "nazi", "jihad",
    # Words WordNet calls nouns but are primarily adjectives/adverbs in usage
    "young", "local", "social", "true", "least", "means", "thanks",
    "single", "general", "whole", "entire", "following", "present",
    "particular", "special", "natural", "personal", "national",
    "possible", "political", "human", "foreign", "public", "private",
    "common", "recent", "major", "minor", "final", "total", "central",
    "federal", "digital", "official", "initial", "civil", "legal",
    "global", "various", "certain", "further", "rather", "quite",
    "actual", "direct", "clear", "close", "free", "open", "sure",
    "real", "full", "half", "least", "less", "more", "most",
    "early", "late", "later", "former", "latter", "upper", "lower",
    "inner", "outer", "prior", "prior", "overall", "joint", "mutual",
    "broad", "deep", "solid", "plain", "flat", "sharp", "thick",
    "thin", "rough", "smooth", "heavy", "light", "soft", "hard",
    "fast", "slow", "warm", "cool", "bright", "dark", "clean",
    "fresh", "raw", "dry", "wet", "wild", "mild", "bold", "weak",
    "rare", "rich", "poor", "fit", "fair", "odd", "wise", "safe",
    "else", "least", "worth", "alike", "aware", "ready", "alone",
}


_DICT_SET: set[str] = set()

def _init_dict_set(dictionary: list[str]) -> None:
    global _DICT_SET
    _DICT_SET = set(dictionary)


def _is_gerund(word: str) -> bool:
    """True if word is a gerund (verb+ing) whose base verb is in the dictionary."""
    if not word.endswith("ing"):
        return False
    stem = word[:-3]
    if stem in _DICT_SET:
        return True
    if (stem + "e") in _DICT_SET:          # making → make
        return True
    if len(stem) >= 2 and stem[-1] == stem[-2] and stem[:-1] in _DICT_SET:
        return True                         # running → run
    # y→ie: dying → die, lying → lie
    if stem.endswith("y") and (stem[:-1] + "ie") in _DICT_SET:
        return True
    # Also check common verb stems not in dict (stripped by function-word filter)
    EXTRA_VERB_STEMS = {"us", "go", "do", "be", "hav", "mak", "tak", "giv",
                        "com", "say", "see", "get", "kno", "fol", "wor"}
    if stem in EXTRA_VERB_STEMS or (stem + "e") in EXTRA_VERB_STEMS:
        return True
    return False


IRREGULAR_PAST = {
    "saw", "came", "went", "got", "made", "took", "gave", "knew", "told",
    "felt", "left", "kept", "sent", "held", "read", "led", "met",
    "ran", "sat", "set", "won", "put", "cut", "hit", "let", "bit", "ate",
    "drank", "sang", "rang", "swam", "drove", "wrote", "rode", "rose",
    "wore", "bore", "tore", "swore", "chose", "froze", "spoke", "broke",
    "woke", "stole", "began", "drew", "grew", "flew", "threw", "blew",
    "sold", "slept", "wept", "meant", "bent", "lent", "spent",
    "built", "dealt", "dreamt", "leapt", "lost", "cost", "hurt", "quit", "shed",
    "seen", "been", "gone", "done", "come", "given", "taken", "written",
    "hidden", "bitten", "risen", "driven", "ridden", "fallen",
    "blown", "grown", "known", "shown", "thrown", "flown", "drawn",
    "worn", "torn", "sworn", "chosen", "frozen", "spoken", "broken",
    "stolen", "woken", "begun", "forbidden", "forgotten", "gotten",
    "found", "bound", "wound", "ground", "heard",
    "paid", "laid", "led", "fed", "bred", "bled", "sped", "taught", "caught",
    "bought", "fought", "thought", "brought", "sought",
}


def is_good_target(word: str, freq: float) -> bool:
    if word in FUNCTION_WORDS or word in PROFANITY:
        return False
    if word in PROPER_NOUN_BLOCKLIST or word in IRREGULAR_PAST:
        return False
    # Gerunds are poor targets even when WordNet classifies them as nouns
    if _is_gerund(word):
        return False
    # Frequency range: common enough to know, rare enough to be interesting
    if freq < 1e-6 or freq > 3e-4:
        return False
    # Length sweet spot
    if not (4 <= len(word) <= 10):
        return False
    # Abstract suffixes that sneak through as WordNet nouns
    if any(word.endswith(s) for s in {
        "ness", "ment", "tion", "sion", "ism", "ity", "ogy", "phy",
        "ible", "able", "ival", "ical",
    }):
        return False
    return True


def main():
    ensure_wordnet()
    os.makedirs("data", exist_ok=True)

    # ── Dictionary ────────────────────────────────────────────────────────
    print("Fetching top 150k words from wordfreq (English)...")
    candidates = top_n_list("en", 150_000)

    print("Filtering to valid content words...")
    dictionary = [w for w in candidates if is_valid_dictionary_word(w)][:20_000]
    print(f"Dictionary size: {len(dictionary)}")

    with open("data/dictionary.json", "w") as f:
        json.dump(dictionary, f, indent=None, separators=(",", ":"))
    print("Wrote data/dictionary.json")

    # ── Targets ───────────────────────────────────────────────────────────
    print("\nLoading WordNet nouns...")
    all_nouns = get_wordnet_nouns()
    print(f"WordNet noun lemmas: {len(all_nouns)}")

    # Keep only nouns that are also in our guessable dictionary
    dict_set = set(dictionary)
    candidate_nouns = [w for w in all_nouns if w in dict_set]
    print(f"Nouns in dictionary: {len(candidate_nouns)}")

    # Build stem cache before gerund detection
    _init_dict_set(dictionary)

    # Score by wordfreq frequency, filter, sort most-common first
    scored = []
    for w in candidate_nouns:
        freq = word_frequency(w, "en")
        if is_good_target(w, freq):
            scored.append((freq, w))

    scored.sort(reverse=True)
    targets = [w for _, w in scored][:3000]

    print(f"Target pool size: {len(targets)}")
    with open("data/targets.json", "w") as f:
        json.dump(targets, f, indent=None, separators=(",", ":"))
    print("Wrote data/targets.json")

    print("\nSample dictionary words (first 30):")
    print(dictionary[:30])
    print("\nSample target words (first 30):")
    print(targets[:30])

    # Sanity checks
    bad = [w for w in dictionary[:50] if w in FUNCTION_WORDS]
    if bad:
        print(f"\nWARNING: function words in top-50: {bad}")
    else:
        print("\nFunction word check passed.")

    print("\nDone. Review data/targets.json before running precompute.py.")


if __name__ == "__main__":
    main()
