-- La casilla de novedades del checkout.
--
-- Se guarda en el pedido y no solo en `subscribers` porque esto es la prueba
-- del consentimiento: queda con fecha y con el pedido en el que se dio.
ALTER TABLE "orders"
  ADD COLUMN "newsletter_opt_in" BOOLEAN NOT NULL DEFAULT false;
