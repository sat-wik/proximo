"""
Curate the dictionary and target pool.

Run from the project root:
    packages/embeddings/.venv/bin/python packages/embeddings/scripts/curate-words.py

Outputs:
    data/dictionary.json   — 25,000 guessable words, frequency-ordered
    data/targets.json      — 3,000 common English nouns

Strategy (structural filters first, blocklists last):
  1. Candidates come from wordfreq's top-200k English list (frequency order).
  2. A word must lemmatize into WordNet (any part of speech) to count as
     English — this kills brands, misspellings, and foreign words that leak
     into web-frequency data, while keeping inflections (dogs, running).
  3. Proper nouns are detected structurally: a word whose WordNet presence
     is exclusively instance synsets (London, Jesus, America) is a proper
     noun. First names come from the NLTK names corpus, minus a hand
     allowlist of names that are primarily common words (rose, hope, mark).
  4. A curated blocklist removes slurs, profanity, explicit sexual terms,
     and drug terms from both lists; a second, stricter tier removes
     sensitive-but-legitimate words (violence, disease…) from targets only.
  5. Targets are additionally required to be primary-sense nouns, base
     forms (no plurals/gerunds), 4–10 letters, and inside a familiarity
     frequency band.
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
    from nltk.corpus import wordnet, names
except ImportError:
    sys.exit("Missing: pip install nltk")

DICTIONARY_SIZE = 25_000
TARGET_POOL_SIZE = 3_000


def ensure_corpora():
    for corpus in ("wordnet", "omw-1.4", "names"):
        try:
            nltk.data.find(f"corpora/{corpus}")
        except LookupError:
            print(f"Downloading NLTK corpus: {corpus}...")
            nltk.download(corpus.replace("-", "-"), quiet=True)


# ---------------------------------------------------------------------------
# Function words — purely grammatical, never useful guesses
# ---------------------------------------------------------------------------
FUNCTION_WORDS = {
    "the", "and", "but", "nor", "yet", "for", "this", "that", "these",
    "those", "each", "every", "either", "neither", "both", "all", "any",
    "some", "few", "many", "much", "more", "most", "other", "another",
    "such", "what", "which", "whose", "whatever", "whichever", "whoever",
    "whomever", "who", "whom", "how", "where", "why", "when", "than",
    "not", "own", "same", "very", "too", "quite", "rather", "just",
    "only", "also", "still", "already", "soon", "now", "then", "always",
    "never", "ever", "often", "usually", "sometimes", "perhaps", "maybe",
    "was", "were", "been", "being", "are", "has", "had", "having",
    "does", "did", "done", "doing", "will", "would", "shall", "should",
    "may", "might", "must", "can", "could", "ought",
    "his", "her", "hers", "him", "she", "its", "they", "them", "their",
    "theirs", "our", "ours", "your", "yours", "myself", "yourself",
    "himself", "herself", "itself", "ourselves", "themselves",
    "into", "onto", "with", "within", "without", "about", "against",
    "between", "through", "during", "before", "after", "above", "below",
    "from", "off", "over", "under", "again", "further", "once", "here",
    "there", "across", "along", "around", "behind", "beside", "besides",
    "beyond", "except", "inside", "near", "outside", "past", "per",
    "plus", "since", "throughout", "toward", "towards", "underneath",
    "until", "unto", "upon", "via", "although", "because", "unless",
    "while", "though", "even", "whether", "whereas", "whereby",
    "however", "therefore", "thus", "hence", "otherwise", "instead",
    "meanwhile", "nevertheless", "nonetheless", "furthermore", "moreover",
    "yeah", "yes", "okay", "hey", "hello", "wow", "oh", "ah", "um",
    "gonna", "wanna", "gotta", "lol", "omg", "etc", "aka",
}

# ---------------------------------------------------------------------------
# Blocklist tier 1 — excluded from BOTH dictionary and targets:
# slurs, profanity, explicit sexual terms, drug terms.
# ---------------------------------------------------------------------------
BLOCKLIST = {
    # Slurs (never acceptable in any list)
    "nigger", "nigga", "niggers", "niggas", "faggot", "faggots", "fag",
    "fags", "kike", "spic", "chink", "wetback", "gook", "tranny",
    "retard", "retards", "retarded", "dyke", "coon", "raghead",
    # Profanity
    "fuck", "fucking", "fucked", "fucker", "fuckers", "fucks", "shit",
    "shits", "shitty", "shitting", "bullshit", "horseshit", "cunt",
    "cunts", "cock", "cocks", "dick", "dicks", "dickhead", "ass",
    "asses", "asshole", "assholes", "arse", "arsehole", "bitch",
    "bitches", "bitchy", "damn", "damned", "goddamn", "piss", "pissed",
    "pissing", "crap", "crappy", "slut", "sluts", "slutty", "twat",
    "wank", "wanker", "prick", "pricks", "turd", "turds", "douche",
    "douchebag", "bastard", "bastards", "pussy", "pussies", "tits",
    "titties", "boob", "boobs", "whore", "whores", "hoe", "hoes",
    "skank", "motherfucker", "motherfucking", "jackass", "dumbass",
    "badass", "hardass", "smartass",
    # Explicit sexual terms
    "sex", "sexy", "sexual", "sexually", "sexuality", "porn", "porno",
    "pornography", "pornographic", "erotic", "erotica", "orgasm",
    "orgasms", "penis", "penises", "vagina", "vaginas", "vaginal",
    "anal", "anus", "rectum", "genital", "genitals", "genitalia",
    "scrotum", "testicle", "testicles", "clitoris", "semen", "sperm",
    "ejaculate", "ejaculation", "masturbate", "masturbation", "libido",
    "aroused", "arousal", "horny", "kinky", "fetish", "fetishes",
    "bdsm", "bondage", "dildo", "vibrator", "condom", "condoms",
    "viagra", "prostitute", "prostitutes", "prostitution", "brothel",
    "hooker", "hookers", "stripper", "strippers", "striptease",
    "orgy", "threesome", "incest", "pedophile", "pedophilia",
    "molest", "molester", "molestation", "rape", "raped", "rapist",
    "rapists", "raping", "nympho", "smut", "xxx", "milf", "hentai",
    "blowjob", "handjob", "cum", "cumming", "jizz", "boner",
    "nipple", "nipples", "topless", "foreplay", "kamasutra",
    # Drugs
    "cocaine", "heroin", "meth", "methamphetamine", "amphetamine",
    "amphetamines", "marijuana", "cannabis", "opium", "opioid",
    "opioids", "opiate", "opiates", "fentanyl", "oxycodone", "ketamine",
    "lsd", "mdma", "psilocybin", "narcotic", "narcotics", "crackhead",
    "stoner", "stoned", "junkie", "junkies", "overdose", "overdosed",
    # Hate / extremist terms
    "nazi", "nazis", "hitler", "jihad", "jihadist", "isis", "kkk",
    "swastika", "genocide", "holocaust", "lynching", "lynch",
}

# ---------------------------------------------------------------------------
# Blocklist tier 2 — legitimate vocabulary (fine to GUESS) that makes a
# poor or uncomfortable TARGET word. Excluded from targets only.
# ---------------------------------------------------------------------------
TARGET_BLOCKLIST = {
    # Violence / death
    "murder", "murderer", "suicide", "suicidal", "terrorist", "terrorism",
    "massacre", "slaughter", "torture", "hostage", "kidnap", "assault",
    "abortion", "corpse", "cadaver", "slavery", "slave", "funeral",
    "coffin", "grave", "cemetery", "widow", "orphan", "execution",
    "hanging", "strangle", "suffocate", "bloodshed", "warfare", "bomb",
    "bomber", "sniper", "shooter", "shooting", "gunman", "stabbing",
    # Disease / bodily
    "cancer", "tumor", "leukemia", "diabetes", "dementia", "alzheimer",
    "hiv", "aids", "herpes", "chlamydia", "syphilis", "gonorrhea",
    "diarrhea", "vomit", "feces", "urine", "urinal", "rectal", "enema",
    "hemorrhoid", "abscess", "pus", "mucus", "phlegm", "corpse",
    "autopsy", "morgue", "miscarriage", "stillborn", "leprosy", "plague",
    "anorexia", "bulimia", "obesity",
    # Substances (legal but off-tone as answers)
    "nicotine", "tobacco", "cigarette", "cigar", "vodka", "whiskey",
    "tequila", "bourbon", "hangover", "drunk", "drunken", "alcoholic",
    "alcoholism", "addict", "addiction", "casino", "gambling",
    # Religion / identity (fine words, divisive answers)
    "bible", "koran", "quran", "allah", "buddha", "christ", "satan",
    "hell", "heaven", "mosque", "church", "synagogue", "atheist",
    "muslim", "christian", "jewish", "catholic", "hindu", "buddhist",
    "gay", "lesbian", "transgender", "queer", "racism", "racist",
    "sexism", "sexist", "nude", "naked", "underwear", "lingerie",
    "bra", "panties", "thong", "cleavage", "breast", "breasts",
    "buttock", "buttocks", "groin", "crotch", "pubic",
    # Drug slang whose primary sense is borderline
    "dope", "weed", "bong", "joint", "hash", "acid", "crack",
    # Brand-adjacent or leering connotations
    "playboy", "playmate", "mistress", "harem", "geisha",
    # Calendar proper-ish nouns kept in the dictionary via the allowlist
    "april", "june", "august", "summer", "autumn", "dawn",
}

# Number words are WordNet nouns but make meaningless targets
NUMBER_WORDS = {
    "zero", "one", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
    "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
    "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "thousand", "million", "billion", "trillion", "dozen",
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
    "eighth", "ninth", "tenth", "half", "quarter", "couple",
}

# ---------------------------------------------------------------------------
# Names-corpus entries that are primarily common English words — keep these
# despite appearing in the NLTK names corpus.
# ---------------------------------------------------------------------------
NAME_WORD_ALLOWLIST = {
    "rose", "roses", "daisy", "iris", "lily", "ivy", "jasmine", "hazel",
    "olive", "pearl", "ruby", "jade", "amber", "opal", "coral", "violet",
    "poppy", "heather", "laurel", "willow", "fern", "flora", "blossom",
    "hope", "faith", "grace", "joy", "patience", "prudence", "charity",
    "honey", "melody", "harmony", "destiny", "serenity", "trinity",
    "dawn", "autumn", "summer", "sunny", "misty", "windy", "stormy",
    "rainy", "crystal", "star", "sky", "raven", "robin", "wren", "colt",
    "buck", "fox", "wolf", "bear", "cat", "kitty", "bunny", "birdie",
    "mark", "marks", "bill", "bills", "frank", "franks", "ray", "rays",
    "grant", "grants", "hunter", "hunters", "mason", "masons", "cooper",
    "coopers", "carter", "carters", "tanner", "tanners", "porter",
    "porters", "miller", "millers", "baker", "bakers", "farmer",
    "farmers", "fisher", "fishers", "shepherd", "shepherds", "smith",
    "smiths", "taylor", "taylors", "turner", "turners", "walker",
    "walkers", "weaver", "weavers", "gardner", "sawyer", "chase",
    "dean", "deans", "drew", "wade", "miles", "chip", "chips", "cliff",
    "cliffs", "clay", "brook", "brooks", "glen", "glens", "heath",
    "lane", "lanes", "reed", "reeds", "rusty", "sandy", "rocky",
    "stone", "stones", "wood", "woods", "worth", "young", "noble",
    "sterling", "art", "arts", "belle", "bells", "bonnie", "candy",
    "cherry", "cherries", "ginger", "goldie", "kit", "kits", "major",
    "majors", "marshal", "marshals", "duke", "dukes", "earl", "earls",
    "king", "kings", "page", "pages", "penny", "pennies", "prince",
    "princes", "sage", "scarlet", "sherry", "tawny", "angel", "angels",
    "april", "may", "june", "august", "gene", "genes", "jean", "jeans",
    "jimmy", "jack", "jacks", "josh", "bob", "bobs", "dolly", "dot",
    "dots", "fanny", "nick", "nicks", "pat", "pats", "peg", "pegs",
    "polly", "sally", "tommy", "victor", "victors", "wanda", "biff",
    "skip", "skips", "spike", "spikes", "tab", "tabs", "van", "vans",
}

# Brands and internet-era proper nouns that sneak past WordNet (e.g. the
# verb "google") or the instance test.
BRAND_BLOCKLIST = {
    "google", "googled", "googling", "netflix", "twitter", "facebook",
    "instagram", "youtube", "amazon", "microsoft", "apple's", "iphone",
    "ipad", "ipod", "android", "tiktok", "snapchat", "whatsapp",
    "reddit", "wikipedia", "yahoo", "ebay", "paypal", "uber", "airbnb",
    "spotify", "tesla", "walmart", "starbucks", "mcdonalds", "nike",
    "adidas", "disney", "pixar", "marvel", "pokemon", "nintendo",
    "playstation", "xbox", "minecraft", "fortnite", "linux", "windows",
    "photoshop", "bitcoin", "ethereum", "harvard", "oxford", "stanford",
    "yale", "princeton", "gmail", "internet",
}

# Modern vocabulary that predates nothing but WordNet's last update.
MODERN_ALLOWLIST = {
    "smartphone", "smartphones", "selfie", "selfies", "emoji", "emojis",
    "podcast", "podcasts", "blog", "blogs", "blogger", "bloggers",
    "wifi", "app", "apps", "hashtag", "hashtags", "meme", "memes",
    "startup", "startups", "website", "websites", "webcam", "webpage",
    "email", "emails", "texting", "download", "downloads", "upload",
    "uploads", "username", "password", "passwords", "login", "logout",
    "online", "offline", "unfollow", "unfriend", "crowdfunding",
    "livestream", "vlog", "vlogger", "chatbot", "chatbots", "malware",
    "phishing", "spam", "screenshot", "screenshots", "touchscreen",
    "earbuds", "drone", "drones", "vegan", "vegans", "gluten",
    "kale", "quinoa", "smoothie", "smoothies", "barista", "baristas",
    "foodie", "foodies", "brunch", "staycation", "binge", "spoiler",
    "spoilers", "reboot", "remix", "playlist", "playlists", "streaming",
}

_NAME_SET: set[str] = set()


def init_name_set():
    global _NAME_SET
    _NAME_SET = {
        n.lower()
        for n in names.words("male.txt") + names.words("female.txt")
    }
    _NAME_SET -= NAME_WORD_ALLOWLIST
    _NAME_SET -= DEMONYM_ALLOWLIST  # "French" is in the names corpus


# Nationality / language / religion words are capitalized-only in WordNet
# but are guesses players WILL type — keep them in the dictionary (they
# remain barred from targets, which require a lowercase lemma).
DEMONYM_ALLOWLIST = {
    "american", "americans", "english", "french", "spanish", "german",
    "germans", "italian", "italians", "chinese", "japanese", "russian",
    "russians", "arabic", "latin", "greek", "greeks", "hindi", "korean",
    "koreans", "dutch", "portuguese", "polish", "turkish", "hebrew",
    "irish", "scottish", "welsh", "mexican", "mexicans", "indian",
    "indians", "african", "africans", "european", "europeans", "asian",
    "asians", "canadian", "canadians", "australian", "australians",
    "british", "roman", "romans", "viking", "vikings", "christian",
    "christians", "muslim", "muslims", "jewish", "catholic", "catholics",
    "buddhist", "buddhists", "hindu", "hindus", "protestant",
    "protestants", "egyptian", "egyptians", "persian", "persians",
    "swedish", "norwegian", "danish", "finnish", "thai", "vietnamese",
    "indonesian", "brazilian", "brazilians", "scandinavian",
}


def has_lowercase_lemma(w: str) -> bool:
    """True if WordNet writes w lowercase somewhere.

    Lemma names preserve capitalization: "china" (porcelain) exists
    lowercase, but "York"/"Musa"/"Romanian" only ever appear capitalized —
    a reliable proper-noun signal that instance-checking alone misses
    (nationalities, genus names, and royal houses aren't instance synsets).
    """
    for s in wordnet.synsets(w):
        for lemma in s.lemmas():
            if lemma.name() == w:
                return True
    return False


def is_common_english_word(w: str) -> bool:
    """True if w (or its base form) is a lowercase WordNet lemma.

    Checking the BASE form keeps inflections (dogs → dog) while still
    rejecting capitalized-only words. morphy overgenerates on short
    junk ("der" → comparative of "d"), so bases under 3 chars don't count.
    """
    if w in MODERN_ALLOWLIST or w in DEMONYM_ALLOWLIST:
        return True
    for pos in ("n", "v", "a", "r"):
        base = wordnet.morphy(w, pos)
        if base and len(base) >= 3 and has_lowercase_lemma(base):
            return True
    return False


def is_valid_dictionary_word(w: str) -> bool:
    if not (3 <= len(w) <= 14):
        return False
    if not (w.isalpha() and w.isascii() and w == w.lower()):
        return False
    if w in FUNCTION_WORDS or w in BLOCKLIST or w in BRAND_BLOCKLIST:
        return False
    if w in _NAME_SET:
        return False
    return is_common_english_word(w)


def is_dominantly_noun(w: str) -> bool:
    """True if w is USED mostly as a noun, not merely listed as one.

    wordnet.synsets() orders noun senses first regardless of real usage
    ("general", "young" lead with obscure noun senses), so sense order is
    useless here. SemCor lemma counts give actual usage frequency per
    part of speech; fall back to synset-count majority for rare words
    with no count data.
    """
    noun_count = 0
    total_count = 0
    noun_synsets = 0
    other_synsets = 0
    for s in wordnet.synsets(w):
        is_noun = s.pos() == "n"
        if is_noun:
            if s.instance_hypernyms():
                return False  # proper-noun sense present
            noun_synsets += 1
        else:
            other_synsets += 1
        for lemma in s.lemmas():
            if lemma.name().lower() == w:
                c = lemma.count()
                total_count += c
                if is_noun:
                    noun_count += c
    if noun_synsets == 0:
        return False
    if total_count >= 3:
        return noun_count / total_count >= 0.55
    return noun_synsets >= other_synsets


def is_base_form(w: str, dict_set: set[str]) -> bool:
    """Excludes plurals and inflections; targets must be their own lemma."""
    if wordnet.morphy(w, "n") != w:
        return False  # cats → cat
    # Plural-only lemmas ("thanks", "means", "finances") sneak past morphy;
    # if stripping the s/es yields another dictionary word, it's a plural
    if w.endswith("s") and (w[:-1] in dict_set or w[:-2] in dict_set):
        return False
    return True


def is_good_target(w: str, freq: float, dict_set: set[str]) -> bool:
    if w in TARGET_BLOCKLIST or w in MODERN_ALLOWLIST or w in NUMBER_WORDS:
        return False
    if not (4 <= len(w) <= 10):
        return False
    # Familiar enough to know, rare enough to be interesting
    if freq < 1e-6 or freq > 3e-4:
        return False
    if w.endswith("ing"):  # gerunds make mushy targets
        return False
    if not has_lowercase_lemma(w):  # english, romanian, york
        return False
    return is_base_form(w, dict_set) and is_dominantly_noun(w)


def main():
    ensure_corpora()
    init_name_set()
    os.makedirs("data", exist_ok=True)

    print("Fetching top 200k words from wordfreq (English)...")
    candidates = top_n_list("en", 200_000)

    print("Filtering dictionary (WordNet-gated, proper-noun-free)...")
    dictionary = []
    for w in candidates:
        if is_valid_dictionary_word(w):
            dictionary.append(w)
            if len(dictionary) == DICTIONARY_SIZE:
                break
    print(f"Dictionary size: {len(dictionary)}")

    with open("data/dictionary.json", "w") as f:
        json.dump(dictionary, f, separators=(",", ":"))
    print("Wrote data/dictionary.json")

    print("\nSelecting targets...")
    dict_set = set(dictionary)
    scored = []
    for w in dictionary:
        freq = word_frequency(w, "en")
        if is_good_target(w, freq, dict_set):
            scored.append((freq, w))
    scored.sort(reverse=True)
    targets = [w for _, w in scored][:TARGET_POOL_SIZE]

    print(f"Target pool size: {len(targets)}")
    with open("data/targets.json", "w") as f:
        json.dump(targets, f, separators=(",", ":"))
    print("Wrote data/targets.json")

    print("\nFirst 30 dictionary words:", dictionary[:30])
    print("\nFirst 30 targets:", targets[:30])
    print("\nLast 10 targets (rarest):", targets[-10:])


if __name__ == "__main__":
    main()
