import type {Match} from './travel.ts';
export function diningHighlight(m:Match):'mentioned'|'uncertain'|'alternative'|null{
 if(m.category!=='Food')return null;
 if(/unnamed|alternative|suggested|area search|comparable/i.test(m.kind))return 'alternative';
 if(/AI-identified|uncertain/i.test(m.kind))return 'uncertain';
 return /named|mentioned/i.test(m.kind)?'mentioned':'uncertain';
}
