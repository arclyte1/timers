const colors=['#91a6ff','#45c992','#f3b35c','#ff8790','#ca9cff','#67d4e8','#f2f3f5','#b4c0d0'];
const login=document.querySelector('#profileLogin'),palette=document.querySelector('#palette'),message=document.querySelector('#message');
let selected='#91a6ff';
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
function render(){palette.innerHTML=colors.map(color=>`<button class="swatch ${color===selected?'selected':''}" style="--color:${color}" data-color="${color}" title="${color}" aria-label="Выбрать ${color}"></button>`).join('');palette.querySelectorAll('.swatch').forEach(button=>button.onclick=()=>{selected=button.dataset.color;render()})}
(async()=>{let response=await fetch('/api/auth/me');if(!response.ok)return location='/login';let user=(await response.json()).user;selected=user.nickColor||selected;login.textContent=user.login;login.style.color=selected;render()})();
document.querySelector('#save').onclick=async()=>{let response=await fetch('/api/auth/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickColor:selected})}),data=await response.json();if(!response.ok){message.textContent=data.error;return}login.style.color=data.user.nickColor;message.textContent='Цвет сохранён'};
document.querySelector('#logout').onclick=async()=>{await fetch('/api/auth/logout',{method:'POST'});location='/login'};
