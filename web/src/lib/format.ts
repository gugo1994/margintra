export const money=(value:number,currency='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency,minimumFractionDigits:2}).format(value);
export const pct=(value:number|null)=>value===null?'N/A':`${value.toFixed(2)}%`;
