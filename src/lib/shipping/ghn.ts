import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export async function getGhnShipmentStatus(
  token: string,
  shipment: { shopId: number; orderCode: string; clientOrderCode: string },
): Promise<string> {
  const url = new URL("https://dev-online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/detail");
  url.searchParams.set("order_code", shipment.orderCode);
  const response = await fetch(url, {
    headers: { Token: token, ShopId: String(shipment.shopId) },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  const result = await response.json() as {
    code?: unknown;
    data?: { order_code?: unknown; client_order_code?: unknown; shop_id?: unknown; status?: unknown };
  } | null;
  const detail = result?.data;
  // GHN Staging may clear the client order code when a shipment is cancelled.
  const cancelledWithoutClientCode = detail?.status === "cancel" &&
    (detail.client_order_code == null || detail.client_order_code === "");
  if (!response.ok || result?.code !== 200 || !detail ||
      detail.order_code !== shipment.orderCode || detail.shop_id !== shipment.shopId ||
      (detail.client_order_code !== shipment.clientOrderCode && !cancelledWithoutClientCode) ||
      typeof detail.status !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.status)) {
    throw new Error("GHN_STATUS_UNAVAILABLE");
  }
  return detail.status;
}

function encryptionKey(): Buffer {
  const encoded = process.env.GHN_CREDENTIALS_ENCRYPTION_KEY?.trim() || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("GHN_KEY_MISSING");
  const key = Buffer.from(encoded,"base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("GHN_KEY_MISSING");
  return key;
}
export function encryptGhnToken(token:string,storeId:string):string {
  const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
  cipher.setAAD(Buffer.from(`growdesk:ghn:staging:${storeId}`));
  const data=Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64"),cipher.getAuthTag().toString("base64"),data.toString("base64")].join(":");
}
export function decryptGhnToken(value:string,storeId:string):string {
  const [version,iv,tag,data,...rest]=value.split(":");
  if(version!=="v1"||!iv||!tag||!data||rest.length) throw new Error("GHN_CREDENTIAL_INVALID");
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(iv,"base64"));
  decipher.setAAD(Buffer.from(`growdesk:ghn:staging:${storeId}`)); decipher.setAuthTag(Buffer.from(tag,"base64"));
  return Buffer.concat([decipher.update(Buffer.from(data,"base64")),decipher.final()]).toString("utf8");
}
type GhnShop = { _id:number; name:string; status:number };
export async function verifyGhnShop(token:string, shopId:number, deadline?: AbortSignal):Promise<{ name:string }> {
  function requestSignal() {
    const timeout = AbortSignal.timeout(10000);
    return deadline ? AbortSignal.any([deadline, timeout]) : timeout;
  }
  function requestFailure(error: unknown) {
    return new Error(deadline && error instanceof Error && error.name === "TimeoutError"
      ? "GHN_TIMEOUT" : "GHN_NETWORK_FAILED");
  }
  let offset=0;
  for(let page=0;page<10;page++) {
    const url=new URL("https://dev-online-gateway.ghn.vn/shiip/public-api/v2/shop/all");
    url.searchParams.set("offset",String(offset)); url.searchParams.set("limit","100");
    let response:Response;
    try { response=await fetch(url,{headers:{Token:token},cache:"no-store",signal:requestSignal(),redirect:"error"}); }
    catch (error) { throw requestFailure(error); }
    if(response.status === 401 || response.status === 403) {
      // Distinguish an invalid token from a token that cannot access the shop API.
      let tokenCheck:Response;
      try { tokenCheck=await fetch("https://dev-online-gateway.ghn.vn/shiip/public-api/master-data/province",{headers:{Token:token,ShopId:String(shopId)},cache:"no-store",signal:requestSignal(),redirect:"error"}); }
      catch (error) { throw requestFailure(error); }
      if (tokenCheck.ok) {
        const result:unknown=await tokenCheck.json().catch(()=>null);
        if(result && typeof result === "object" && "code" in result && result.code === 200) throw new Error("GHN_SHOP_ACCESS_DENIED");
      }
      if(tokenCheck.status === 401 || tokenCheck.status === 403) throw new Error("GHN_AUTH_OR_SHOP_REJECTED");
      throw new Error("GHN_REQUEST_FAILED");
    }
    if(!response.ok) throw new Error("GHN_REQUEST_FAILED");
    const result:unknown=await response.json();
    if (!result || typeof result !== "object" || !("code" in result) || result.code !== 200 || !("data" in result) || !result.data || typeof result.data !== "object" || !("shops" in result.data) || !Array.isArray(result.data.shops)) throw new Error("GHN_RESPONSE_INVALID");
    const shops=result.data.shops as GhnShop[];
    const match=shops.find(shop=>Number(shop._id)===shopId && shop.status===1 && typeof shop.name==="string");
    if(match) return {name:match.name.slice(0,160)};
    if(shops.length < 100 || !("last_offset" in result.data) || typeof result.data.last_offset !== "number" || result.data.last_offset <= offset) break;
    offset=result.data.last_offset;
  }
  throw new Error("GHN_SHOP_NOT_FOUND");
}
export type GhnShipmentPayload = { client_order_code:string; to_name:string; to_phone:string; to_address:string; to_province_name:string; to_ward_name:string; is_new_to_address:true; weight:number; length:number; width:number; height:number; service_type_id:2; payment_type_id:1; required_note:"KHONGCHOXEMHANG"; cod_amount:number; content:string };
export async function ghnShipmentRequest(token:string,shopId:number,mode:"preview"|"create",payload:GhnShipmentPayload):Promise<{orderCode:string|null;totalFee:number;expectedDelivery:string|null}> {
  let response:Response;
  try {response=await fetch(`https://dev-online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/${mode}`,{method:"POST",headers:{Token:token,ShopId:String(shopId),"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:AbortSignal.timeout(15000),redirect:"error"});}
  catch {throw new Error("GHN_NETWORK_UNCERTAIN");}
  const result:unknown=await response.json().catch(()=>null);
  if(result && typeof result === "object" && "code_message" in result && result.code_message === "FROM_ADDRESS_CONVERT_FAIL") throw new Error("GHN_FROM_ADDRESS_INVALID");
  if(!response.ok || !result || typeof result!=="object" || !("code" in result) || result.code!==200 || !("data" in result) || !result.data || typeof result.data!=="object") throw new Error("GHN_PROVIDER_REJECTED");
  const data=result.data as {order_code?:unknown;total_fee?:unknown;expected_delivery_time?:unknown};
  if(typeof data.total_fee!=="number" || !Number.isSafeInteger(data.total_fee) || data.total_fee<0 || (mode === "create" && (typeof data.order_code!=="string" || !data.order_code))) throw new Error("GHN_RESPONSE_INVALID");
  const expected=typeof data.expected_delivery_time === "string" && Number.isFinite(Date.parse(data.expected_delivery_time)) ? data.expected_delivery_time : null;
  return {orderCode:typeof data.order_code==="string" && data.order_code ? data.order_code : null,totalFee:data.total_fee,expectedDelivery:expected};
}
export type GhnLocation = { id:number; name:string };
export async function ghnLocations(token:string,shopId:number,provinceId?:number):Promise<GhnLocation[]> {
  const path=provinceId ? "ward/all-by-province-id" : "province/all";
  const url=new URL(`https://dev-online-gateway.ghn.vn/shiip/public-api/v3/master-data/${path}`);
  url.searchParams.set("offset","0");url.searchParams.set("limit","200");if(provinceId)url.searchParams.set("province_id",String(provinceId));
  const response=await fetch(url,{headers:{Token:token,ShopId:String(shopId)},cache:"no-store",signal:AbortSignal.timeout(10000),redirect:"error"});
  const json:unknown=await response.json().catch(()=>null);
  if(!response.ok || !json || typeof json!=="object" || !("code" in json) || json.code!==200 || !("data" in json) || !Array.isArray(json.data))throw new Error("GHN_LOCATIONS_UNAVAILABLE");
  return json.data.filter((item:unknown):item is {_id:number;name:string;status:number}=>item !== null && typeof item==="object" && "_id" in item && Number.isSafeInteger(item._id) && "name" in item && typeof item.name==="string" && "status" in item && item.status===1).map((item:{_id:number;name:string})=>({id:item._id,name:item.name})).sort((a:GhnLocation,b:GhnLocation)=>a.name.localeCompare(b.name,"vi"));
}
