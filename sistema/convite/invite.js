(function () {
  const form = document.querySelector('#invite-form');
  const errorBox = document.querySelector('#invite-error');
  function error(message) { errorBox.textContent = message; errorBox.hidden = false; }
  form.onsubmit = async event => {
    event.preventDefault();
    errorBox.hidden = true;
    const password = document.querySelector('#password').value;
    const confirmation = document.querySelector('#password-confirm').value;
    if (password.length < 8) return error('Use pelo menos 8 caracteres.');
    if (password !== confirmation) return error('As duas senhas precisam ser iguais.');
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const client = SupabaseStore.getClient();
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session) throw new Error('O convite expirou ou já foi utilizado. Peça um novo convite.');
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw updateError;
      window.location.replace('../admin/');
    } catch (caught) { error(caught.message || 'Não foi possível ativar o acesso.'); }
    finally { button.disabled = false; }
  };
})();
