-- ── Un intento de compra no es un registro contable ─────────────────
-- El trigger original prohibía borrar CUALQUIER pedido, y la razón sigue
-- siendo buena: un pedido pagado es contabilidad, y el ON DELETE CASCADE de
-- order_items permitiría que un solo DELETE se llevase la venta y sus copias
-- congeladas.
--
-- Pero la regla se escribió pensando en ventas y acabó aplicándose también a
-- los carritos abandonados, donde nunca entró dinero. Esas filas no
-- documentan nada y sí estorban: order_items apunta a la variante con
-- ON DELETE RESTRICT, así que un checkout que nadie pagó bloqueaba el borrado
-- de su producto para siempre.
--
-- Ahora el trigger distingue. Deja pasar el borrado solo cuando las TRES
-- señales del cobro dicen que no lo hubo; con que una sola diga que sí, el
-- pedido es intocable como antes. Son las mismas tres condiciones que usa
-- NUNCA_COBRADO en el código: la base de datos y la aplicación tienen que
-- estar de acuerdo, y aquí es donde se impone.
CREATE OR REPLACE FUNCTION forbid_order_delete() RETURNS trigger AS $fn$
BEGIN
  IF OLD.status IN ('PENDING_PAYMENT', 'CANCELLED')
     AND OLD.stripe_payment_intent_id IS NULL
     AND OLD.paid_at IS NULL
  THEN
    -- Devolver OLD en un BEFORE DELETE es lo que autoriza el borrado.
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'Los pedidos con cobro no se borran (id=%, estado=%). Usa CANCELLED o REFUNDED.',
    OLD.id, OLD.status;
END;
$fn$ LANGUAGE plpgsql;
