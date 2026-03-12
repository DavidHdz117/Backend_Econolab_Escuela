--
-- PostgreSQL database dump
--

\restrict gvYDYKuqUOeeJ53bgFo4trQpzTWCucIF1sMezuW9y5dsBfcowI3WGhrjSraWVGO

-- Dumped from database version 17.8 (6108b59)
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

DROP INDEX IF EXISTS operativo.idx_studies_name;
DROP INDEX IF EXISTS operativo.idx_studies_code;
ALTER TABLE IF EXISTS ONLY operativo.studies DROP CONSTRAINT IF EXISTS "UQ_70bc3802c9dc98aa38a6422cb69";
ALTER TABLE IF EXISTS ONLY operativo.studies DROP CONSTRAINT IF EXISTS "PK_b100ff0c4a0ad02a9c2270d45b6";
ALTER TABLE IF EXISTS operativo.studies ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS operativo.studies_id_seq;
DROP TABLE IF EXISTS operativo.studies;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: studies; Type: TABLE; Schema: operativo; Owner: -
--

CREATE TABLE operativo.studies (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    code character varying(50) NOT NULL,
    description text,
    "durationMinutes" integer DEFAULT 60 NOT NULL,
    "normalPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "difPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "specialPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "hospitalPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "otherPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "defaultDiscountPercent" numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    method character varying(150),
    indicator character varying(150),
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    type operativo.studies_type_enum DEFAULT 'study'::operativo.studies_type_enum NOT NULL,
    status operativo.studies_status_enum DEFAULT 'active'::operativo.studies_status_enum NOT NULL
);


--
-- Name: studies_id_seq; Type: SEQUENCE; Schema: operativo; Owner: -
--

CREATE SEQUENCE operativo.studies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: studies_id_seq; Type: SEQUENCE OWNED BY; Schema: operativo; Owner: -
--

ALTER SEQUENCE operativo.studies_id_seq OWNED BY operativo.studies.id;


--
-- Name: studies id; Type: DEFAULT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.studies ALTER COLUMN id SET DEFAULT nextval('operativo.studies_id_seq'::regclass);


--
-- Data for Name: studies; Type: TABLE DATA; Schema: operativo; Owner: -
--

COPY operativo.studies (id, name, code, description, "durationMinutes", "normalPrice", "difPrice", "specialPrice", "hospitalPrice", "otherPrice", "defaultDiscountPercent", method, indicator, "isActive", "createdAt", "updatedAt", type, status) FROM stdin;
1	GLUCOSA	GLU-001	Estudio de glucosa	60	110.00	80.00	90.00	140.00	150.00	0.00	\N	\N	t	2026-02-16 23:49:15.700267	2026-02-16 23:49:15.700267	study	active
\.


--
-- Name: studies_id_seq; Type: SEQUENCE SET; Schema: operativo; Owner: -
--

SELECT pg_catalog.setval('operativo.studies_id_seq', 1, true);


--
-- Name: studies PK_b100ff0c4a0ad02a9c2270d45b6; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.studies
    ADD CONSTRAINT "PK_b100ff0c4a0ad02a9c2270d45b6" PRIMARY KEY (id);


--
-- Name: studies UQ_70bc3802c9dc98aa38a6422cb69; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.studies
    ADD CONSTRAINT "UQ_70bc3802c9dc98aa38a6422cb69" UNIQUE (code);


--
-- Name: idx_studies_code; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_studies_code ON operativo.studies USING btree (code);


--
-- Name: idx_studies_name; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_studies_name ON operativo.studies USING btree (name);


--
-- PostgreSQL database dump complete
--

\unrestrict gvYDYKuqUOeeJ53bgFo4trQpzTWCucIF1sMezuW9y5dsBfcowI3WGhrjSraWVGO

