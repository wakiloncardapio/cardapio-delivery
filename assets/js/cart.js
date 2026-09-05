(function(){
  const listeners=new Set();
  let items=JSON.parse(localStorage.getItem('cardapio_cart')||'[]');
  function persist(){ localStorage.setItem('cardapio_cart',JSON.stringify(items)); listeners.forEach(fn=>fn(get())); }
  function get(){ return items.map(i=>({...i})); }
  function add(item){ items.push({...item,cartId:crypto.randomUUID()}); persist(); }
  function remove(id){ items=items.filter(i=>i.cartId!==id); persist(); }
  function quantity(id,value){ if(value<=0) return remove(id); items=items.map(i=>i.cartId===id?{...i,quantity:value}:i); persist(); }
  function clear(){ items=[]; persist(); }
  function subtotal(){ return items.reduce((sum,i)=>sum+i.unitTotal*i.quantity,0); }
  function count(){ return items.reduce((sum,i)=>sum+i.quantity,0); }
  function hasFreeShipping(){ return items.some(i=>i.freeShippingEnabled===true); }
  function subscribe(fn){ listeners.add(fn); fn(get()); return ()=>listeners.delete(fn); }
  window.CartStore={get,add,remove,quantity,clear,subtotal,count,hasFreeShipping,subscribe};
})();