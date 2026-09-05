<?php
declare(strict_types=1);
session_start();
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/database/conexao.php';

$root = dirname(__DIR__);
$action = $_GET['action'] ?? 'catalog';

function readJson(string $path, array $fallback = []): array {
    if (!is_file($path)) return $fallback;
    $data = json_decode((string)file_get_contents($path), true);
    return is_array($data) ? $data : $fallback;
}
function writeJson(string $path, array $data): void {
    $dir = dirname($path); if (!is_dir($dir)) mkdir($dir, 0775, true);
    $tmp = $path . '.tmp'; file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT), LOCK_EX); rename($tmp, $path);
}
function body(): array { $data=json_decode((string)file_get_contents('php://input'),true); return is_array($data)?$data:[]; }
function respond(array $data, int $status=200): never { http_response_code($status); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }
function requireAdmin(): void { if (empty($_SESSION['cardapio_admin'])) respond(['error'=>'Não autorizado'],401); }
function money(float $v): string { return 'R$ '.number_format($v,2,',','.'); }
function orderNote(string $number,array $p,string $storeName): string {
    $lines=["🟣 ".strtoupper($storeName)." — PEDIDO {$number}","","Cliente: ".($p['customer']['name']??''),"Telefone: ".($p['customer']['phone']??''),"","ITENS"];
    foreach(($p['items']??[]) as $i=>$item){ $lines[]=($i+1).". ".($item['quantity']??1)."x ".($item['name']??'')." — ".money((float)($item['unitTotal']??0)*(int)($item['quantity']??1)); foreach(($item['selections']??[]) as $s) $lines[]="   ".($s['groupName']??'').": ".implode(', ',array_column($s['options']??[],'name')); if(!empty($item['notes']))$lines[]="   Obs: ".$item['notes']; }
    $lines[]=""; $lines[]="Subtotal: ".money((float)($p['subtotal']??0)); $lines[]="Entrega: ".money((float)($p['deliveryFee']??0)); $lines[]="TOTAL: ".money((float)($p['total']??0)); $lines[]="Pagamento: ".($p['paymentMethod']??'');
    if(($p['fulfillment']??'')==='delivery'){ $a=$p['address']??[]; $lines[]="Endereço: ".($a['street']??'').", ".($a['number']??'')." — ".($a['neighborhood']??'')." — ".($a['city']??'')." — CEP ".($a['zip']??''); if(!empty($a['reference']))$lines[]="Referência: ".$a['reference']; }
    return implode("\n",$lines);
}
function catalog(string $root): array {
    return ['settings'=>readJson($root.'/data/config/store.json'),'categories'=>readJson($root.'/data/categories/catalog.json'),'products'=>readJson($root.'/data/products/catalog.json')];
}

if ($action==='catalog') respond(catalog($root));

if ($action==='order' && $_SERVER['REQUEST_METHOD']==='POST') {
    $p=body(); $name=trim((string)($p['customer']['name']??'')); $phone=preg_replace('/\D/','',(string)($p['customer']['phone']??''));
    if($name===''||strlen($phone)<10||empty($p['items'])||(float)($p['total']??0)<=0) respond(['error'=>'Confira cliente endereço e itens do pedido'],422);
    $settings=catalog($root)['settings']; $storeName=trim((string)($settings['establishmentName']??$settings['storeName']??'Seu Delivery')) ?: 'Seu Delivery';
    $id=bin2hex(random_bytes(16)); $number='PED-'.date('ymd').'-'.strtoupper(substr(bin2hex(random_bytes(3)),0,4)); $note=orderNote($number,$p,$storeName);
    $record=['id'=>$id,'order_number'=>$number,'status'=>'novo','payment_status'=>'pendente','created_at'=>date(DATE_ATOM)]+$p;
    $ordersPath=$root.'/data/orders/orders.json'; $orders=readJson($ordersPath); array_unshift($orders,$record); writeJson($ordersPath,array_slice($orders,0,1000));
    if($pdo=db()){ try{ $st=$pdo->prepare("INSERT INTO orders(id,order_number,customer_name,customer_phone,customer_email,fulfillment,address_json,items_json,subtotal,delivery_fee,total,payment_method,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"); $st->execute([$id,$number,$name,$p['customer']['phone']??'',$p['customer']['email']??'',$p['fulfillment']??'delivery',json_encode($p['address']??[],JSON_UNESCAPED_UNICODE),json_encode($p['items'],JSON_UNESCAPED_UNICODE),(float)$p['subtotal'],(float)$p['deliveryFee'],(float)$p['total'],$p['paymentMethod']??'',$p['notes']??'']); }catch(Throwable $e){} }
    $email=trim((string)($settings['orderEmail']??'')); if($email!=='') @mail($email,"Pedido {$number} — {$storeName}",$note,"Content-Type: text/plain; charset=UTF-8");
    foreach(['ORDER_EMAIL_WEBHOOK_URL','ORDER_WHATSAPP_WEBHOOK_URL'] as $key){ $url=getenv($key); if($url){ $ctx=stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/json\r\n",'content'=>json_encode(['orderNumber'=>$number,'note'=>$note,'order'=>$p],JSON_UNESCAPED_UNICODE),'timeout'=>3]]); @file_get_contents($url,false,$ctx); } }
    $wa=preg_replace('/\D/','',(string)($settings['whatsapp']??'')); respond(['orderNumber'=>$number,'note'=>$note,'whatsappUrl'=>$wa?"https://wa.me/{$wa}?text=".rawurlencode($note):'','emailUrl'=>$email?"mailto:{$email}?subject=".rawurlencode("Pedido {$number}")."&body=".rawurlencode($note):'','pixKey'=>$p['paymentMethod']==='pix'?($settings['pixKey']??''):'','paymentUrl'=>$p['paymentMethod']==='payment_link'?($settings['paymentLink']??''):'']);
}

if ($action==='admin-catalog') { requireAdmin(); respond(catalog($root)); }
if ($action==='admin-save' && $_SERVER['REQUEST_METHOD']==='POST') { requireAdmin(); $p=body(); if(empty($p['settings'])||!isset($p['categories'],$p['products']))respond(['error'=>'Catálogo inválido'],422); writeJson($root.'/data/config/store.json',$p['settings']); writeJson($root.'/data/categories/catalog.json',$p['categories']); writeJson($root.'/data/products/catalog.json',$p['products']); respond(['ok'=>true]); }
if ($action==='admin-orders') { requireAdmin(); if($pdo=db()){ try{$rows=$pdo->query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 300")->fetchAll();respond(['orders'=>$rows]);}catch(Throwable $e){} } respond(['orders'=>readJson($root.'/data/orders/orders.json')]); }
if ($action==='admin-order-status' && $_SERVER['REQUEST_METHOD']==='POST') { requireAdmin(); $p=body(); $ordersPath=$root.'/data/orders/orders.json'; $orders=readJson($ordersPath); foreach($orders as &$o){ if(($o['id']??'')===($p['id']??'')){ $o['status']=$p['status']??$o['status']; $o['payment_status']=$p['payment_status']??($o['payment_status']??'pendente'); }} writeJson($ordersPath,$orders); if($pdo=db()){try{$st=$pdo->prepare("UPDATE orders SET status=?,payment_status=? WHERE id=?");$st->execute([$p['status']??'novo',$p['payment_status']??'pendente',$p['id']??'']);}catch(Throwable $e){}} respond(['ok'=>true]); }
if ($action==='upload' && $_SERVER['REQUEST_METHOD']==='POST') { requireAdmin(); if(empty($_FILES['file'])||$_FILES['file']['error']!==UPLOAD_ERR_OK)respond(['error'=>'Envio inválido'],422); $f=$_FILES['file']; if($f['size']>5*1024*1024||!str_starts_with((string)mime_content_type($f['tmp_name']),'image/'))respond(['error'=>'Use imagem de até 5 MB'],422); $ext=strtolower(pathinfo($f['name'],PATHINFO_EXTENSION)); if(!in_array($ext,['jpg','jpeg','png','webp','gif'],true))$ext='jpg'; $name=date('YmdHis').'-'.bin2hex(random_bytes(4)).'.'.$ext; $dir=$root.'/assets/images/uploads'; if(!is_dir($dir))mkdir($dir,0775,true); move_uploaded_file($f['tmp_name'],$dir.'/'.$name); respond(['url'=>'assets/images/uploads/'.$name],201); }
respond(['error'=>'Rota não encontrada'],404);
