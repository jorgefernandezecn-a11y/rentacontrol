export function insuranceDetails(value){
 const input=value&&typeof value==='object'?value:{};
 const result={};
 for(const key of ['vehicleBrand','vehicleModel','vehicleYear','propertyAddress','insuredPeople']){
  const text=String(input[key]??'').trim();
  if(text.length>(key==='insuredPeople'?5000:key==='propertyAddress'?1000:100))throw Object.assign(new Error('El campo de seguro es demasiado largo.'),{status:400});
  result[key]=text;
 }
 if(result.vehicleYear&&(!/^\d{4}$/.test(result.vehicleYear)||Number(result.vehicleYear)<1886||Number(result.vehicleYear)>2200))throw Object.assign(new Error('Captura un año del vehículo válido (1886–2200).'),{status:400});
 return result;
}
