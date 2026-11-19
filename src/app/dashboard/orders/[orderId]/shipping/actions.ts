"use server";
import { getMerchantContext } from "@/app/dashboard/data";
import { requireExpectedStore } from "@/lib/active-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptGhnToken,ghnShipmentRequest,ghnLocations,type GhnShipmentPayload } from "@/lib/shipping/ghn";
import type { GhnCheckoutSnapshot } from "@/lib/shipping/packaging";
import { syncGhnStatus } from "@/lib/shipping/sync-ghn-status";
import { revalidatePath } from "next/cache";

type Result={ok:boolean;message:string;fee?:number;orderCode?:string;expected?:string|null};
function canonical(value:unknown):string { return JSON.stringify(value, (_key, item:unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item); }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function syncShipmentStatus(_previous: Result, form: FormData): Promise<Result> {
  try {
    const { store, membership } = await getMerchantContext();
    if (!store || membership?.role !== "owner") throw new Error("UNAUTHORIZED");
    requireExpectedStore(form, store.id);
    const orderId = String(form.get("order_id") || "");
    if (!uuid.test(orderId)) throw new Error("INVALID_ORDER");

    const admin = createAdminClient();
    const [shipmentResult, connectionResult] = await Promise.all([
      admin.from("store_ghn_shipments").select("shop_id,order_code,client_order_code")
        .eq("store_id", store.id).eq("order_id", orderId).eq("state", "created").maybeSingle(),
      admin.from("store_ghn_connections").select("shop_id,token_ciphertext,environment")
        .eq("store_id", store.id).maybeSingle(),
    ]);
    const shipment = shipmentResult.data;
    const connection = connectionResult.data;
    if (shipmentResult.error || connectionResult.error || !shipment?.order_code) {
      throw new Error("SHIPMENT_UNAVAILABLE");
    }
    const shopId = Number(shipment.shop_id);
    if (connection?.environment !== "staging" || Number(connection.shop_id) !== shopId) {
      return { ok: false, message: "Hãy kết nối lại tài khoản GHN thử nghiệm đã tạo vận đơn này." };
    }

    await syncGhnStatus(admin, {
      storeId: store.id,
      orderId,
      shopId,
      orderCode: shipment.order_code,
      clientOrderCode: shipment.client_order_code,
    }, connection.token_ciphertext);

    revalidatePath(`/dashboard/orders/${orderId}/shipping`);
    return { ok: true, message: "Đã đồng bộ trạng thái từ GHN." };
  } catch {
    return { ok: false, message: "Chưa đồng bộ được trạng thái từ GHN. Hãy thử lại." };
  }
}
function err(error:unknown):Result {const code=error instanceof Error?error.message:"";if(code==="GHN_NETWORK_UNCERTAIN") return {ok:false,message:"Không nhận được phản hồi từ GHN. Nếu đang tạo vận đơn, hãy thử lại với cùng thông tin để kiểm tra kết quả."};if(code==="GHN_FROM_ADDRESS_INVALID") return {ok:false,message:"GHN chưa xác định được địa chỉ lấy hàng của shop. Hãy kiểm tra địa chỉ cửa hàng trong tài khoản GHN thử nghiệm."};if(code==="GHN_PROVIDER_REJECTED") return {ok:false,message:"GHN chưa chấp nhận thông tin vận chuyển. Kiểm tra địa chỉ, dịch vụ và số điện thoại."};return {ok:false,message:"Chưa xử lý được yêu cầu GHN. Hãy kiểm tra kết nối và thử lại."};}
async function context(form:FormData) {
  const ctx=await getMerchantContext();if(!ctx.store || ctx.membership?.role!=="owner") throw new Error("UNAUTHORIZED");requireExpectedStore(form,ctx.store.id);
  const id=String(form.get("order_id") || "");if(!uuid.test(id)) throw new Error("INVALID_ORDER");
  const {data:order,error}=await ctx.supabase.from("orders").select("id,store_id,public_code,customer_name,customer_phone,delivery_address,fulfillment,status,payment_method,payment_status,total_vnd,cancellation_request_status").eq("store_id",ctx.store.id).eq("id",id).maybeSingle();
  if(error || !order || order.fulfillment!=="delivery" || !["confirmed","preparing","ready"].includes(order.status) || order.cancellation_request_status==="pending") throw new Error("ORDER_NOT_ELIGIBLE");
  const admin=createAdminClient();const {data:connection,error:connectionError}=await admin.from("store_ghn_connections").select("shop_id,token_ciphertext,environment").eq("store_id",ctx.store.id).maybeSingle();
  if(connectionError || !connection || connection.environment!=="staging") throw new Error("NO_CONNECTION");
  const snapshot = await admin.from("orders").select("ghn_shipping_quote").eq("id", order.id).eq("store_id", ctx.store.id).single();
  if (snapshot.error && snapshot.error.code !== "42703" && snapshot.error.code !== "PGRST204") throw snapshot.error;
  const quote = snapshot.data?.ghn_shipping_quote as GhnCheckoutSnapshot | null | undefined;
  if (quote && quote.shop_id !== Number(connection.shop_id)) throw new Error("NO_CONNECTION");
  return {ctx,store:ctx.store,order,admin,connection,quote,token:decryptGhnToken(connection.token_ciphertext,ctx.store.id)};
}
function payload(form:FormData,order:{id:string;customer_name:string;customer_phone:string;delivery_address:string|null;payment_method:string;payment_status:string;total_vnd:number},quote?:GhnCheckoutSnapshot|null):GhnShipmentPayload {
  const province=quote?.province ?? String(form.get("province")||"").trim(),ward=quote?.ward ?? String(form.get("ward")||"").trim();
  const value=(field:string,max:number)=>{const raw=String(form.get(field)||"");const n=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(n)||n<1||n>max)throw new Error("INVALID_PACKAGE");return n;};
  const weight=quote?.weight ?? value("weight",19999),length=quote?.length ?? value("length",200),width=quote?.width ?? value("width",200),height=quote?.height ?? value("height",200);
  if(!province||province.length>120||!ward||ward.length>120||!order.delivery_address||order.delivery_address.trim().length<5)throw new Error("INVALID_ADDRESS");
  if(order.payment_method==="bank_transfer" && order.payment_status!=="paid") throw new Error("PAYMENT_UNCONFIRMED");
  const cod=order.payment_status==="paid"?0:Number(order.total_vnd);
  if(!Number.isSafeInteger(cod)||cod<0||cod>50000000)throw new Error("INVALID_COD");
  return {client_order_code:`GD-${order.id}`,to_name:order.customer_name,to_phone:order.customer_phone,to_address:order.delivery_address,to_province_name:province,to_ward_name:ward,is_new_to_address:true,weight,length,width,height,service_type_id:2,payment_type_id:1,required_note:"KHONGCHOXEMHANG",cod_amount:cod,content:"Hàng hóa theo đơn GrowDesk"};
}
function friendly(error:unknown):Result {const code=error instanceof Error?error.message:"";if(code==="PAYMENT_UNCONFIRMED")return {ok:false,message:"Đơn chuyển khoản phải được xác nhận thanh toán trước khi tạo vận đơn."};if(code==="INVALID_PACKAGE")return {ok:false,message:"Kiểm tra kích thước và khối lượng (dưới 20 kg)."};if(code==="INVALID_ADDRESS")return {ok:false,message:"Hãy nhập tỉnh, phường/xã và kiểm tra địa chỉ nhận hàng của đơn."};if(code==="INVALID_COD")return {ok:false,message:"Số tiền thu hộ không hợp lệ hoặc vượt giới hạn GHN."};if(code==="ORDER_NOT_ELIGIBLE")return {ok:false,message:"Đơn phải là đơn giao hàng đã xác nhận, đang chuẩn bị hoặc sẵn sàng và không có yêu cầu hủy."};if(code==="NO_CONNECTION")return {ok:false,message:"Hãy kết nối GHN thử nghiệm trước."};return err(error);}
export async function previewShipment(form:FormData):Promise<Result> {try{const x=await context(form);const request=payload(form,x.order,x.quote);const result=await ghnShipmentRequest(x.token,Number(x.connection.shop_id),"preview",request);return {ok:true,message:"Đã lấy phí dự kiến từ GHN thử nghiệm.",fee:result.totalFee,expected:result.expectedDelivery};}catch(e){return friendly(e);}}
export async function createShipment(form:FormData):Promise<Result> {
  try {
    const x=await context(form);const request=payload(form,x.order,x.quote);const shop=Number(x.connection.shop_id);
    const {data:existing,error:readError}=await x.admin.from("store_ghn_shipments").select("order_id,shop_id,request_payload,state,order_code,total_fee").eq("order_id",x.order.id).eq("store_id",x.store.id).maybeSingle();if(readError)throw readError;
    if(existing?.state==="created")return {ok:true,message:"Đơn đã có vận đơn GHN thử nghiệm.",orderCode:existing.order_code,fee:Number(existing.total_fee)};
    if(existing && (Number(existing.shop_id)!==shop || canonical(existing.request_payload)!==canonical(request))) return {ok:false,message:"Yêu cầu trước đang chờ xác nhận. Hãy dùng lại đúng thông tin ban đầu để tránh tạo trùng vận đơn."};
    if(!existing){await ghnShipmentRequest(x.token,shop,"preview",request);const {error:insertError}=await x.admin.from("store_ghn_shipments").insert({order_id:x.order.id,store_id:x.store.id,shop_id:shop,client_order_code:request.client_order_code,request_payload:request});if(insertError && insertError.code!=="23505")throw insertError;}
    const {data:reserved,error:reserveError}=await x.admin.from("store_ghn_shipments").select("request_payload,state,order_code,total_fee,shop_id").eq("order_id",x.order.id).eq("store_id",x.store.id).maybeSingle();if(reserveError||!reserved)throw new Error("RESERVE_FAILED");
    if(reserved.state==="created")return {ok:true,message:"Đơn đã có vận đơn GHN thử nghiệm.",orderCode:reserved.order_code,fee:Number(reserved.total_fee)};
    if(Number(reserved.shop_id)!==shop || canonical(reserved.request_payload)!==canonical(request))return {ok:false,message:"Yêu cầu trước đang chờ xác nhận. Hãy dùng lại đúng thông tin ban đầu để tránh tạo trùng vận đơn."};
    const now=new Date(), lease=new Date(now.getTime()+60000).toISOString();
    const {data:claim,error:claimError}=await x.admin.from("store_ghn_shipments").update({lease_until:lease}).eq("order_id",x.order.id).eq("store_id",x.store.id).eq("state","pending").or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select("order_id").maybeSingle();
    if(claimError)throw claimError;if(!claim)return {ok:false,message:"Vận đơn đang được xử lý. Hãy đợi một phút rồi kiểm tra lại."};
    const result=await ghnShipmentRequest(x.token,shop,"create",request);
    const {data:saved,error:saveError}=await x.admin.from("store_ghn_shipments").update({state:"created",order_code:result.orderCode,total_fee:result.totalFee,expected_delivery_time:result.expectedDelivery,lease_until:null,updated_at:new Date().toISOString()}).eq("order_id",x.order.id).eq("store_id",x.store.id).eq("state","pending").eq("lease_until",lease).select("order_code").maybeSingle();if(saveError || !saved)throw new Error("GHN_NETWORK_UNCERTAIN");
    revalidatePath(`/dashboard/orders/${x.order.id}/shipping`);return {ok:true,message:"Đã tạo vận đơn GHN thử nghiệm.",orderCode:result.orderCode || undefined,fee:result.totalFee,expected:result.expectedDelivery};
  }catch(e){return friendly(e);}
}

export async function loadGhnWards(form:FormData):Promise<{ok:boolean;items:{id:number;name:string}[]}> {try {const raw=String(form.get("province_id")||"");if(!/^[1-9]\d{0,9}$/.test(raw))return {ok:false,items:[]};const x=await context(form);const items=await ghnLocations(x.token,Number(x.connection.shop_id),Number(raw));return {ok:true,items};}catch{return {ok:false,items:[]};}}
