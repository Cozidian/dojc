import { WORDLIST_VERSION } from './types.ts'

/**
 * English practice list, versioned by WORDLIST_VERSION.
 * Order is part of the seed. Append words; don't reorder. Bump the version when the list changes
 * so old clients cannot disagree with the server about which words a seed meant.
 * Stored tests keep their target text, so a later list does not rewrite history.
 */
const RAW = `
the of and to a in is it you that he was for on are with as his they be at one
have this from or had by hot but some what there we can out other were all your
when up use word how said an each she which do their time if will way about many
then them would write like so these her long make thing see him two has look more
day could go come did number sound no most people my over know water than call
first who may down side been now find any new work part take get place made live
where after back little only round man year came show every good me give our under
name very through just form sentence great think say help low line differ turn
cause much mean before move right boy old too same tell does set three want air
well also play small end put home read hand port large spell add even land here
must big high such follow act why ask men change went light kind off need house
picture try us again animal point mother world near build self earth father head
stand own page should country found answer school grow study still learn plant
cover food sun four between state keep eye never last let thought city tree cross
farm hard start might story saw far sea draw left late run press close night real
life few north open seem together next white children begin got walk example ease
paper group always music those both mark book letter until mile river car feet
care second enough plain girl usual young above often begin important family
until along something something miss idea enough book almost let children side
car mile night walk white sea begin open seem example begin group always music
those both mark letter river feet care second young above girl usual plain
something miss idea almost along family important often
another around because before being below better between black bring build
carry change children city close country cut different does down during each
early earth enough every example eye face family far father feel feet few
field finally find fire first fish five follow food form found four friend
from front full game gave get girl give go going good got great green ground
group grow had half hand hard has have he head hear help her here high him
his hold home horse hot hour house how however hundred idea if important in
into is it its just keep kind knew know land large last later learn leave
left let life light like line list little live long look made make man many
map may me mean men might mile miss money more morning most mother move much
must my name near need never new next night no north not nothing now number
off often oh old on once one only open or other our out over own page paper
part people picture place plant play point put read really right river run
said same saw say school sea second see seem self sentence set several should
show side small so some something sometimes song soon sound spell start state
still stop story study such sun sure table take talk tell ten than that the
their them then there these they thing think this those though thought three
through time to together told too took tree try turn two under until up upon
us use usual very walk want was watch water way we well went were what when
where which while white who why will with without word work world would write
year you young your
able black blank blast bleed blend bless blew blind blink bliss block blood
bloom blow blue blunt blur blush bluff cable fable goblin noble pebble problem
public stable tablet tumble available probably establish obliged bubble trouble
humble gamble amble rumble rubble oblige
aqua papa mama saga lava afar agar adam aha drama salad radar altar karma alpha
plaza macaw banana canada panama alabama bazaar mana kappa ask data area away
`.replaceAll('  ', ' ')

function compile(raw: string): readonly string[] {
  const seen = new Set<string>()
  const words: string[] = []
  for (const word of raw.split(/\s+/)) {
    if (!word || seen.has(word)) continue
    if (!/^[a-z]+$/.test(word)) {
      throw new Error(`wordlist ${WORDLIST_VERSION} has a bad token: ${word}`)
    }
    seen.add(word)
    words.push(word)
  }
  return words
}

export const WORDLIST: readonly string[] = compile(RAW)
