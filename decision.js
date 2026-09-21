export const tiers = ['small','medium','large'];
export const profiles = {
  simple:{tier:'small',effort:'medium'},
  routine_small:{tier:'small',effort:'high'},
  patient:{tier:'small',effort:'max'},
  routine:{tier:'medium',effort:'low'},
  difficult:{tier:'medium',effort:'medium'},
  critical:{tier:'large',effort:'medium'},
  urgent_critical:{tier:'large',effort:'low'},
};
export function chooseRoute(a,{failures=0,previousTier}={},models) {
  let profile,reason;
  if(a.clarity==='unclear') [profile,reason]=a.guard!=='ordinary'||failures>=2 ? ['difficult','unclear_with_guard'] : ['routine','unclear_request'];
  else if(a.family!=='general'&&a.complexity>=(a.family==='system_software'?80:90)) [profile,reason]=[a.urgency==='urgent'?'urgent_critical':'critical','very_complex_coding'];
  else if(a.guard!=='ordinary'||failures>=2) [profile,reason]=['difficult',a.guard!=='ordinary'?a.guard:'repeated_failures'];
  else if(a.complexity<=30) [profile,reason]=['simple','simple'];
  else if(a.complexity<=60) [profile,reason]=['routine_small','routine_small_default'];
  else if(a.urgency==='relaxed'&&a.family==='bounded_software'&&a.complexity<=85) [profile,reason]=['patient','well_scoped_and_can_wait'];
  else if(a.family==='general'&&a.urgency!=='urgent'&&a.complexity<=85) [profile,reason]=['routine_small','general_complex'];
  else [profile,reason]=['difficult','difficult'];
  if(a.clarity==='clear'&&a.continuation&&previousTier&&tiers.indexOf(previousTier)>tiers.indexOf(profiles[profile].tier)&&profiles[profile].tier==='small') [profile,reason]=['difficult','retain_task_tier'];
  return {...profiles[profile],profile,reason,...(models ? {model:models[profiles[profile].tier]} : {})};
}

export function readModels(config) {
  const models = config?.models;
  if (!models || tiers.some(tier => typeof models[tier] !== 'string' || !/^[^\s/]+\/[^\s]+$/.test(models[tier]))) {
    throw new TypeError('Configure models.small, models.medium and models.large as provider/model references.');
  }
  return Object.fromEntries(tiers.map(tier => [tier, models[tier]]));
}
