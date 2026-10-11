// Turns a Nominatim address into the place fields posters use. For England the county
// is the ceremonial county (Essex, West Sussex, Somerset), the one people mean and the
// one Dan is learning, not the unitary authority the lookup often returns.

export const CEREMONIAL = new Set([
  'Bedfordshire', 'Berkshire', 'Bristol', 'Buckinghamshire', 'Cambridgeshire', 'Cheshire', 'City of London',
  'Cornwall', 'Cumbria', 'Derbyshire', 'Devon', 'Dorset', 'Durham', 'East Riding of Yorkshire', 'East Sussex',
  'Essex', 'Gloucestershire', 'Greater London', 'Greater Manchester', 'Hampshire', 'Herefordshire',
  'Hertfordshire', 'Isle of Wight', 'Kent', 'Lancashire', 'Leicestershire', 'Lincolnshire', 'Merseyside',
  'Norfolk', 'North Yorkshire', 'Northamptonshire', 'Northumberland', 'Nottinghamshire', 'Oxfordshire',
  'Rutland', 'Shropshire', 'Somerset', 'South Yorkshire', 'Staffordshire', 'Suffolk', 'Surrey',
  'Tyne and Wear', 'Warwickshire', 'West Midlands', 'West Sussex', 'West Yorkshire', 'Wiltshire', 'Worcestershire',
]);

// English unitary authorities and their ceremonial counties.
const UNITARY = {
  'Bath and North East Somerset': 'Somerset', 'North Somerset': 'Somerset',
  'City of Bristol': 'Bristol', 'South Gloucestershire': 'Gloucestershire',
  'Bedford': 'Bedfordshire', 'Central Bedfordshire': 'Bedfordshire', 'Luton': 'Bedfordshire',
  'Bracknell Forest': 'Berkshire', 'Reading': 'Berkshire', 'Slough': 'Berkshire', 'West Berkshire': 'Berkshire',
  'Windsor and Maidenhead': 'Berkshire', 'Royal Borough of Windsor and Maidenhead': 'Berkshire', 'Wokingham': 'Berkshire',
  'Milton Keynes': 'Buckinghamshire', 'Peterborough': 'Cambridgeshire',
  'Cheshire East': 'Cheshire', 'Cheshire West and Chester': 'Cheshire', 'Halton': 'Cheshire', 'Warrington': 'Cheshire',
  'Isles of Scilly': 'Cornwall', 'County Durham': 'Durham', 'Darlington': 'Durham', 'Hartlepool': 'Durham',
  'Stockton-on-Tees': 'Durham', 'Middlesbrough': 'North Yorkshire', 'Redcar and Cleveland': 'North Yorkshire',
  'Cumberland': 'Cumbria', 'Westmorland and Furness': 'Cumbria', 'Derby': 'Derbyshire',
  'Plymouth': 'Devon', 'Torbay': 'Devon', 'Bournemouth, Christchurch and Poole': 'Dorset',
  'Kingston upon Hull': 'East Riding of Yorkshire', 'City of Kingston upon Hull': 'East Riding of Yorkshire',
  'Brighton and Hove': 'East Sussex', 'Southend-on-Sea': 'Essex', 'Thurrock': 'Essex',
  'Portsmouth': 'Hampshire', 'Southampton': 'Hampshire', 'Medway': 'Kent',
  'Blackburn with Darwen': 'Lancashire', 'Blackpool': 'Lancashire', 'Leicester': 'Leicestershire',
  'North Lincolnshire': 'Lincolnshire', 'North East Lincolnshire': 'Lincolnshire',
  'North Northamptonshire': 'Northamptonshire', 'West Northamptonshire': 'Northamptonshire',
  'Nottingham': 'Nottinghamshire', 'Telford and Wrekin': 'Shropshire', 'Stoke-on-Trent': 'Staffordshire',
  'Swindon': 'Wiltshire', 'York': 'North Yorkshire',
  // Metropolitan areas the lookup sometimes names by their combined authority or borough.
  'Liverpool City Region': 'Merseyside', 'Liverpool': 'Merseyside', 'Wirral': 'Merseyside', 'Sefton': 'Merseyside',
  'Knowsley': 'Merseyside', 'St Helens': 'Merseyside', 'West Midlands Combined Authority': 'West Midlands',
  'South Yorkshire Mayoral Combined Authority': 'South Yorkshire', 'West Yorkshire Combined Authority': 'West Yorkshire',
};

// The 32 London boroughs and the City, as the lookup may name them without saying London.
const LONDON = new Set([
  'Barking and Dagenham', 'Barnet', 'Bexley', 'Brent', 'Bromley', 'Camden', 'City of London', 'Croydon', 'Ealing',
  'Enfield', 'Greenwich', 'Hackney', 'Hammersmith and Fulham', 'Haringey', 'Harrow', 'Havering', 'Hillingdon',
  'Hounslow', 'Islington', 'Kensington and Chelsea', 'Kingston upon Thames', 'Lambeth', 'Lewisham', 'Merton',
  'Newham', 'Redbridge', 'Richmond upon Thames', 'Southwark', 'Sutton', 'Tower Hamlets', 'Waltham Forest',
  'Wandsworth', 'Westminster',
]);
const boroughName = s => s?.replace(/^(London Borough of|Royal Borough of|City of (?!London$))\s*/i, '');


export function placeFrom(address) {
  const a = address || {};
  // "City of Edinburgh" is the council area; the town is Edinburgh.
  const town = (a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || '').replace(/^City of (?!London$)/, '') || null;
  const uk = a.country === 'United Kingdom';
  const nation = uk ? a.state : a.country;
  const out = {
    town,
    locality: a.suburb || a.quarter || a.neighbourhood || null,
    county: null,
    adminArea: a.county || a.state_district || null,
    region: uk ? a.state_district || null : a.state || null,
    country: nation || null,
    sovereign: a.country || null,
    borough: null,
  };

  const londonBorough = [a.city_district, a.city, a.county].map(boroughName).find(b => LONDON.has(b));
  if (londonBorough || a.city === 'Greater London' || a.state_district === 'Greater London' || a.county === 'Greater London') {
    out.county = 'Greater London';
    out.borough = londonBorough || a.suburb || null;
    out.town = 'London';
    return out;
  }
  if (nation === 'England') {
    const candidates = [a.county, a.state_district, a.municipality, a.city, a.town];
    out.county = candidates.find(c => CEREMONIAL.has(c))
      || candidates.map(c => UNITARY[c]).find(Boolean)
      || a.county || a.state_district || null;
    return out;
  }
  // Scotland, Wales, Northern Ireland: the council area, which for cities like Edinburgh
  // only arrives as the city. Abroad: the lookup's own county-level area.
  out.county = uk
    ? a.county || a.state_district || a.city || a.state || a.country || null
    : a.county || a.state_district || a.state || a.city || a.country || null;
  return out;
}
