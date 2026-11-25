const amount = value => Number(value.includes(',')?value.replace(/\./g,'').replace(',','.'):value);
const days = '(\\d{1,3})\\s*(?:Kalender\\s*)?Tag(?:en|e)?';
const percent = '(\\d{1,2}(?:[,.]\\d{1,2})?)\\s*%';
const countryCodes = {Deutschland:'DE', Polen:'PL', Ukraine:'UA', Österreich:'AT'};

export function contractTextLines(items) {
  return items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : ' ')).join('');
}

export function contractProjectKey(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'')
    .match(/[a-z0-9]+/g)?.sort().join(' ') ?? '';
}

export function parseContract(text) {
  const lines = text.replace(/\r/g,'').split(/\n|\f/).map(line => line.trim().replace(/\s+/g,' '));
  const flat = lines.join(' ').replace(/\s+/g,' ');
  let partyStart = lines.findIndex(line => /^Nachunternehmer\s*\(?NU\)?\s*$/i.test(line));
  let partyEnd = -1;
  if (partyStart >= 0) {
    partyEnd = lines.findIndex((line,i) => i > partyStart && /^Zwischen den|^wird nachfolgender/i.test(line));
  } else {
    partyEnd = lines.findIndex(line => /nachfolgend.*\bNU\b.*genannt/i.test(line));
    if (partyEnd >= 0) {
      partyStart = lines.findLastIndex((line,i) => i < partyEnd && /^(?:und\s+)?(?:der\s+)?Firma\s*:?$/i.test(line));
    }
  }
  const party = partyStart >= 0 && partyEnd > partyStart ? lines.slice(partyStart+1,partyEnd).filter(Boolean) : [];
  const company = {};
  if (party.length) {
    company.name = party[0];
    company.owner = party.find(line => /^(?:Vertreten durch|Inhaber|Geschäftsführung)\s*:/i.test(line))?.split(':').slice(1).join(':').trim();
    const contacts = party.slice(1).filter(line=>!/^(?:Vertreten durch|Inhaber|Geschäftsführung)\s*:/i.test(line));
    company.email = contacts.join(' ').match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
    company.address = contacts.filter(line=>!line.includes('@')&&!/^(?:Tel|Mobil)[:.]/i.test(line)).join('\n');
    const country = Object.keys(countryCodes).find(name => company.address.endsWith(name));
    if (country) company.country = countryCodes[country];
    else if (/^\d{5}\s+\S/m.test(company.address)) company.country = 'DE';
  }
  const terms = {};
  const pay = flat.match(/(?:Rechnungsstellung und Zahlungen|Zahlungsbedingungen)([\s\S]*?)(?:Ansprechpartner\s*\/|§\s*5\b|$)/i)?.[1] ?? flat;
  const net = pay.match(new RegExp(days+'\\s+netto','i'));
  const discount = pay.match(new RegExp(days+'\\s+mit\\s+'+percent+'\\s*Skonto','i'));
  if (net) terms.netDays = Number(net[1]);
  if (discount) {
    terms.discountDays = Number(discount[1]);
    terms.discountPercent = Number(discount[2].replace(',','.'));
  }
  const hold = pay.match(new RegExp('Sicherheitseinbehalt\\s+in Höhe von\\s+'+percent,'i'));
  if (hold) terms.retentionPercent = Number(hold[1].replace(',','.'));
  const until = flat.match(/(?:befristet\s+bis\s+zum|bis\s+zum)\s+(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+befristet)?/i);
  if (until) terms.contractUntil = [until[3],until[2].padStart(2,'0'),until[1].padStart(2,'0')].join('-');
  if (/Vergütung erfolgt grundsätzlich als Pauschalvergütung/i.test(flat)) {
    terms.termsNote = 'Pauschalvergütung für vereinbarte Teilleistungen. Stundensätze dienen der Kalkulation.';
  }
  const rates = {};
  const projectRates = [];
  const ratePattern = /^(?:[•–-]\s*)?(Projekt\s+([^:]+)|Obermonteur[^:]*|Monteur[^:]*)\s*:\s*([\d.]+,\d{2}|\d+(?:\.\d{1,2})?)\s*€(?:\s*\/\s*(?:Stunde|Std\.?|h))?/i;
  for (const line of lines) {
    const rate = line.match(ratePattern);
    if (!rate) continue;
    if (rate[2]) projectRates.push({project:rate[2].trim(),fitterRate:amount(rate[3])});
    else rates[/^Obermonteur/i.test(rate[1])?'foremanRate':'fitterRate'] = amount(rate[3]);
  }
  const title = lines.findIndex(line => /^(?:\d+[.)]?\s*)?Bauvorhaben\s*:\s*$/i.test(line));
  const projectLines = title >= 0 ? lines.slice(title+1).filter(Boolean) : [];
  const details = [];
  for (const line of projectLines) {
    if (/^\d+\.\s|^Paraphiert|^Seite\s+\d/.test(line)) break;
    const listed = line.match(/^[a-z]\)\s*(.+?)\s+[-–]\s+(.+)$/i);
    if (listed) details.push({project:listed[1],projectAddress:listed[2]});
    else if (!details.length) details.push({project:line});
    else if (details.length===1 && !details[0].projectAddress) details[0].projectAddress=line;
  }
  const options = projectRates.length ? projectRates.map(rate=>({
    ...details.find(detail=>contractProjectKey(detail.project)===contractProjectKey(rate.project)),...rates,...rate
  })) : details.length ? details.map(detail=>({...rates,...detail})) : [{...rates}];
  return {company,terms,options};
}
