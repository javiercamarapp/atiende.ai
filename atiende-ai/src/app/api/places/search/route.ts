import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
export async function POST(req: NextRequest) {
  const{query}=await req.json();
  try{const{data}=await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json',{params:{query,key:process.env.GOOGLE_MAPS_API_KEY,language:'es',region:'mx'}});
    if(data.results?.[0]){const p=data.results[0];const{data:d}=await axios.get('https://maps.googleapis.com/maps/api/place/details/json',{params:{place_id:p.place_id,fields:'formatted_address,formatted_phone_number,website,rating,geometry',key:process.env.GOOGLE_MAPS_API_KEY,language:'es'}});const r=d.result||{};
      return NextResponse.json({result:{address:r.formatted_address,phone:r.formatted_phone_number,website:r.website,rating:r.rating,lat:r.geometry?.location?.lat,lng:r.geometry?.location?.lng}});}
    return NextResponse.json({result:null});}
  catch{return NextResponse.json({result:null});}
}
