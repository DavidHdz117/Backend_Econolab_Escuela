--
-- PostgreSQL database dump
--

\restrict EqSFPSSVQbUCCB0Ep5iUaeXAUPHWs3dwnrq0dD6RPe03qfe5jviHjTAFfduRNUv

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

ALTER TABLE IF EXISTS ONLY public.user_login_logs DROP CONSTRAINT IF EXISTS "FK_f8379df7d627c940c12d301485a";
ALTER TABLE IF EXISTS ONLY public.service_order_items DROP CONSTRAINT IF EXISTS "FK_e4472d1d912bb7be07fe4eeed27";
ALTER TABLE IF EXISTS ONLY public.study_details DROP CONSTRAINT IF EXISTS "FK_ce74d5d770e39ad0f6f30a78052";
ALTER TABLE IF EXISTS ONLY public.user_session DROP CONSTRAINT IF EXISTS "FK_b5eb7aa08382591e7c2d1244fe5";
ALTER TABLE IF EXISTS ONLY public.study_results DROP CONSTRAINT IF EXISTS "FK_9770dae08724b3fc59e83b203ec";
ALTER TABLE IF EXISTS ONLY public.service_orders DROP CONSTRAINT IF EXISTS "FK_8b0f7b334fb34a74c789ccd018f";
ALTER TABLE IF EXISTS ONLY public.study_result_values DROP CONSTRAINT IF EXISTS "FK_70d9dc177a06103a92f5b158924";
ALTER TABLE IF EXISTS ONLY public.study_details DROP CONSTRAINT IF EXISTS "FK_4fcee6d26193d680407c100a154";
ALTER TABLE IF EXISTS ONLY public.service_orders DROP CONSTRAINT IF EXISTS "FK_22a87b10ec2a5b9d939e61768e9";
ALTER TABLE IF EXISTS ONLY public.study_result_values DROP CONSTRAINT IF EXISTS "FK_190fc95b150ec44782150d7be45";
ALTER TABLE IF EXISTS ONLY public.study_results DROP CONSTRAINT IF EXISTS "FK_00e15e46e4afaf45af47fb1d25d";
ALTER TABLE IF EXISTS ONLY operativo.service_order_items DROP CONSTRAINT IF EXISTS "FK_e4472d1d912bb7be07fe4eeed27";
ALTER TABLE IF EXISTS ONLY operativo.study_details DROP CONSTRAINT IF EXISTS "FK_ce74d5d770e39ad0f6f30a78052";
ALTER TABLE IF EXISTS ONLY operativo.study_results DROP CONSTRAINT IF EXISTS "FK_9770dae08724b3fc59e83b203ec";
ALTER TABLE IF EXISTS ONLY operativo.service_orders DROP CONSTRAINT IF EXISTS "FK_8b0f7b334fb34a74c789ccd018f";
ALTER TABLE IF EXISTS ONLY operativo.study_result_values DROP CONSTRAINT IF EXISTS "FK_70d9dc177a06103a92f5b158924";
ALTER TABLE IF EXISTS ONLY operativo.study_details DROP CONSTRAINT IF EXISTS "FK_4fcee6d26193d680407c100a154";
ALTER TABLE IF EXISTS ONLY operativo.service_orders DROP CONSTRAINT IF EXISTS "FK_22a87b10ec2a5b9d939e61768e9";
ALTER TABLE IF EXISTS ONLY operativo.study_result_values DROP CONSTRAINT IF EXISTS "FK_190fc95b150ec44782150d7be45";
ALTER TABLE IF EXISTS ONLY operativo.study_results DROP CONSTRAINT IF EXISTS "FK_00e15e46e4afaf45af47fb1d25d";
ALTER TABLE IF EXISTS ONLY admin.user_login_logs DROP CONSTRAINT IF EXISTS "FK_f8379df7d627c940c12d301485a";
ALTER TABLE IF EXISTS ONLY admin.user_session DROP CONSTRAINT IF EXISTS "FK_b5eb7aa08382591e7c2d1244fe5";
DROP INDEX IF EXISTS public.idx_study_results_service_order;
DROP INDEX IF EXISTS public.idx_study_results_service_item;
DROP INDEX IF EXISTS public.idx_study_results_active;
DROP INDEX IF EXISTS public.idx_studies_name;
DROP INDEX IF EXISTS public.idx_studies_code;
DROP INDEX IF EXISTS public.idx_services_folio;
DROP INDEX IF EXISTS public.idx_service_order_status;
DROP INDEX IF EXISTS public.idx_service_order_patient;
DROP INDEX IF EXISTS public.idx_service_order_doctor;
DROP INDEX IF EXISTS public.idx_service_order_created_at;
DROP INDEX IF EXISTS public.idx_patients_phone;
DROP INDEX IF EXISTS public.idx_patients_name;
DROP INDEX IF EXISTS public.idx_patients_email;
DROP INDEX IF EXISTS public.idx_doctors_phone;
DROP INDEX IF EXISTS public.idx_doctors_name;
DROP INDEX IF EXISTS public.idx_doctors_email;
DROP INDEX IF EXISTS public."IDX_e12875dfb3b1d92d7d7c5377e2";
DROP INDEX IF EXISTS operativo.idx_study_results_service_order;
DROP INDEX IF EXISTS operativo.idx_study_results_service_item;
DROP INDEX IF EXISTS operativo.idx_study_results_active;
DROP INDEX IF EXISTS operativo.idx_studies_name;
DROP INDEX IF EXISTS operativo.idx_studies_code;
DROP INDEX IF EXISTS operativo.idx_services_folio;
DROP INDEX IF EXISTS operativo.idx_service_order_status;
DROP INDEX IF EXISTS operativo.idx_service_order_patient;
DROP INDEX IF EXISTS operativo.idx_service_order_doctor;
DROP INDEX IF EXISTS operativo.idx_service_order_created_at;
DROP INDEX IF EXISTS operativo.idx_patients_phone;
DROP INDEX IF EXISTS operativo.idx_patients_name;
DROP INDEX IF EXISTS operativo.idx_patients_email;
DROP INDEX IF EXISTS operativo.idx_doctors_phone;
DROP INDEX IF EXISTS operativo.idx_doctors_name;
DROP INDEX IF EXISTS operativo.idx_doctors_email;
DROP INDEX IF EXISTS admin."IDX_e12875dfb3b1d92d7d7c5377e2";
ALTER TABLE IF EXISTS ONLY public.patients DROP CONSTRAINT IF EXISTS "UQ_f3fdfcd4c9943fbbd77c26c942a";
ALTER TABLE IF EXISTS ONLY public.service_orders DROP CONSTRAINT IF EXISTS "UQ_ee8acede046a925fbb00ff0053c";
ALTER TABLE IF EXISTS ONLY public.doctors DROP CONSTRAINT IF EXISTS "UQ_764e04456946abd3fbd4155421e";
ALTER TABLE IF EXISTS ONLY public.studies DROP CONSTRAINT IF EXISTS "UQ_70bc3802c9dc98aa38a6422cb69";
ALTER TABLE IF EXISTS ONLY public.study_result_values DROP CONSTRAINT IF EXISTS "PK_de02c2e6a0b34dd7ab6cdb361c4";
ALTER TABLE IF EXISTS ONLY public."user" DROP CONSTRAINT IF EXISTS "PK_cace4a159ff9f2512dd42373760";
ALTER TABLE IF EXISTS ONLY public.study_results DROP CONSTRAINT IF EXISTS "PK_bf5d53356b03af9ae3083ba7113";
ALTER TABLE IF EXISTS ONLY public.user_login_logs DROP CONSTRAINT IF EXISTS "PK_bcad8136a91a5fdba07ea1284f7";
ALTER TABLE IF EXISTS ONLY public.studies DROP CONSTRAINT IF EXISTS "PK_b100ff0c4a0ad02a9c2270d45b6";
ALTER TABLE IF EXISTS ONLY public.user_session DROP CONSTRAINT IF EXISTS "PK_adf3b49590842ac3cf54cac451a";
ALTER TABLE IF EXISTS ONLY public.patients DROP CONSTRAINT IF EXISTS "PK_a7f0b9fcbb3469d5ec0b0aceaa7";
ALTER TABLE IF EXISTS ONLY public.service_orders DROP CONSTRAINT IF EXISTS "PK_914aa74962ee83b10614ea2095d";
ALTER TABLE IF EXISTS ONLY public.doctors DROP CONSTRAINT IF EXISTS "PK_8207e7889b50ee3695c2b8154ff";
ALTER TABLE IF EXISTS ONLY public.service_order_items DROP CONSTRAINT IF EXISTS "PK_6f33fec247bbbd740b40886b962";
ALTER TABLE IF EXISTS ONLY public.study_details DROP CONSTRAINT IF EXISTS "PK_5f322566a8074b855918418abfc";
ALTER TABLE IF EXISTS ONLY operativo.patients DROP CONSTRAINT IF EXISTS "UQ_f3fdfcd4c9943fbbd77c26c942a";
ALTER TABLE IF EXISTS ONLY operativo.service_orders DROP CONSTRAINT IF EXISTS "UQ_ee8acede046a925fbb00ff0053c";
ALTER TABLE IF EXISTS ONLY operativo.doctors DROP CONSTRAINT IF EXISTS "UQ_764e04456946abd3fbd4155421e";
ALTER TABLE IF EXISTS ONLY operativo.studies DROP CONSTRAINT IF EXISTS "UQ_70bc3802c9dc98aa38a6422cb69";
ALTER TABLE IF EXISTS ONLY operativo.study_result_values DROP CONSTRAINT IF EXISTS "PK_de02c2e6a0b34dd7ab6cdb361c4";
ALTER TABLE IF EXISTS ONLY operativo.study_results DROP CONSTRAINT IF EXISTS "PK_bf5d53356b03af9ae3083ba7113";
ALTER TABLE IF EXISTS ONLY operativo.studies DROP CONSTRAINT IF EXISTS "PK_b100ff0c4a0ad02a9c2270d45b6";
ALTER TABLE IF EXISTS ONLY operativo.patients DROP CONSTRAINT IF EXISTS "PK_a7f0b9fcbb3469d5ec0b0aceaa7";
ALTER TABLE IF EXISTS ONLY operativo.service_orders DROP CONSTRAINT IF EXISTS "PK_914aa74962ee83b10614ea2095d";
ALTER TABLE IF EXISTS ONLY operativo.doctors DROP CONSTRAINT IF EXISTS "PK_8207e7889b50ee3695c2b8154ff";
ALTER TABLE IF EXISTS ONLY operativo.service_order_items DROP CONSTRAINT IF EXISTS "PK_6f33fec247bbbd740b40886b962";
ALTER TABLE IF EXISTS ONLY operativo.study_details DROP CONSTRAINT IF EXISTS "PK_5f322566a8074b855918418abfc";
ALTER TABLE IF EXISTS ONLY admin."user" DROP CONSTRAINT IF EXISTS "PK_cace4a159ff9f2512dd42373760";
ALTER TABLE IF EXISTS ONLY admin.user_login_logs DROP CONSTRAINT IF EXISTS "PK_bcad8136a91a5fdba07ea1284f7";
ALTER TABLE IF EXISTS ONLY admin.user_session DROP CONSTRAINT IF EXISTS "PK_adf3b49590842ac3cf54cac451a";
ALTER TABLE IF EXISTS public.user_login_logs ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public."user" ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.study_results ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.study_result_values ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.study_details ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.studies ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.service_orders ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.service_order_items ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.patients ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.doctors ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS operativo.study_results ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS operativo.study_result_values ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS operativo.study_details ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS operativo.studies ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS operativo.service_orders ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS operativo.service_order_items ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS operativo.patients ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS operativo.doctors ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS admin.user_login_logs ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS admin."user" ALTER COLUMN id DROP DEFAULT;
DROP TABLE IF EXISTS public.user_session;
DROP SEQUENCE IF EXISTS public.user_login_logs_id_seq;
DROP TABLE IF EXISTS public.user_login_logs;
DROP SEQUENCE IF EXISTS public.user_id_seq;
DROP TABLE IF EXISTS public."user";
DROP SEQUENCE IF EXISTS public.study_results_id_seq;
DROP TABLE IF EXISTS public.study_results;
DROP SEQUENCE IF EXISTS public.study_result_values_id_seq;
DROP TABLE IF EXISTS public.study_result_values;
DROP SEQUENCE IF EXISTS public.study_details_id_seq;
DROP TABLE IF EXISTS public.study_details;
DROP SEQUENCE IF EXISTS public.studies_id_seq;
DROP TABLE IF EXISTS public.studies;
DROP SEQUENCE IF EXISTS public.service_orders_id_seq;
DROP TABLE IF EXISTS public.service_orders;
DROP SEQUENCE IF EXISTS public.service_order_items_id_seq;
DROP TABLE IF EXISTS public.service_order_items;
DROP SEQUENCE IF EXISTS public.patients_id_seq;
DROP TABLE IF EXISTS public.patients;
DROP SEQUENCE IF EXISTS public.doctors_id_seq;
DROP TABLE IF EXISTS public.doctors;
DROP SEQUENCE IF EXISTS operativo.study_results_id_seq;
DROP TABLE IF EXISTS operativo.study_results;
DROP SEQUENCE IF EXISTS operativo.study_result_values_id_seq;
DROP TABLE IF EXISTS operativo.study_result_values;
DROP SEQUENCE IF EXISTS operativo.study_details_id_seq;
DROP TABLE IF EXISTS operativo.study_details;
DROP SEQUENCE IF EXISTS operativo.studies_id_seq;
DROP TABLE IF EXISTS operativo.studies;
DROP SEQUENCE IF EXISTS operativo.service_orders_id_seq;
DROP TABLE IF EXISTS operativo.service_orders;
DROP SEQUENCE IF EXISTS operativo.service_order_items_id_seq;
DROP TABLE IF EXISTS operativo.service_order_items;
DROP SEQUENCE IF EXISTS operativo.patients_id_seq;
DROP TABLE IF EXISTS operativo.patients;
DROP SEQUENCE IF EXISTS operativo.doctors_id_seq;
DROP TABLE IF EXISTS operativo.doctors;
DROP TABLE IF EXISTS admin.user_session;
DROP SEQUENCE IF EXISTS admin.user_login_logs_id_seq;
DROP TABLE IF EXISTS admin.user_login_logs;
DROP SEQUENCE IF EXISTS admin.user_id_seq;
DROP TABLE IF EXISTS admin."user";
DROP TYPE IF EXISTS public.user_rol_enum;
DROP TYPE IF EXISTS public.study_details_datatype_enum;
DROP TYPE IF EXISTS public.studies_type_enum;
DROP TYPE IF EXISTS public.studies_status_enum;
DROP TYPE IF EXISTS public.service_orders_status_enum;
DROP TYPE IF EXISTS public.patients_gender_enum;
DROP TYPE IF EXISTS operativo.study_details_datatype_enum;
DROP TYPE IF EXISTS operativo.studies_type_enum;
DROP TYPE IF EXISTS operativo.studies_status_enum;
DROP TYPE IF EXISTS operativo.service_orders_status_enum;
DROP TYPE IF EXISTS operativo.patients_gender_enum;
DROP EXTENSION IF EXISTS "uuid-ossp";
DROP SCHEMA IF EXISTS operativo;
DROP SCHEMA IF EXISTS admin;
--
-- Name: admin; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA admin;


--
-- Name: operativo; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA operativo;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: patients_gender_enum; Type: TYPE; Schema: operativo; Owner: -
--

CREATE TYPE operativo.patients_gender_enum AS ENUM (
    'male',
    'female',
    'other'
);


--
-- Name: service_orders_status_enum; Type: TYPE; Schema: operativo; Owner: -
--

CREATE TYPE operativo.service_orders_status_enum AS ENUM (
    'pending',
    'in_progress',
    'delayed',
    'completed',
    'cancelled'
);


--
-- Name: studies_status_enum; Type: TYPE; Schema: operativo; Owner: -
--

CREATE TYPE operativo.studies_status_enum AS ENUM (
    'active',
    'suspended'
);


--
-- Name: studies_type_enum; Type: TYPE; Schema: operativo; Owner: -
--

CREATE TYPE operativo.studies_type_enum AS ENUM (
    'study',
    'package',
    'other'
);


--
-- Name: study_details_datatype_enum; Type: TYPE; Schema: operativo; Owner: -
--

CREATE TYPE operativo.study_details_datatype_enum AS ENUM (
    'category',
    'parameter'
);


--
-- Name: patients_gender_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.patients_gender_enum AS ENUM (
    'male',
    'female',
    'other'
);


--
-- Name: service_orders_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_orders_status_enum AS ENUM (
    'pending',
    'in_progress',
    'delayed',
    'completed',
    'cancelled'
);


--
-- Name: studies_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.studies_status_enum AS ENUM (
    'active',
    'suspended'
);


--
-- Name: studies_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.studies_type_enum AS ENUM (
    'study',
    'package',
    'other'
);


--
-- Name: study_details_datatype_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.study_details_datatype_enum AS ENUM (
    'category',
    'parameter'
);


--
-- Name: user_rol_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_rol_enum AS ENUM (
    'admin',
    'recepcionista',
    'unassigned'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: user; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin."user" (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    email character varying(50) NOT NULL,
    password character varying(60) NOT NULL,
    token character varying(6),
    confirmed boolean DEFAULT false NOT NULL,
    rol public.user_rol_enum DEFAULT 'admin'::public.user_rol_enum NOT NULL,
    "resetTokenExpiresAt" timestamp without time zone,
    "resetRequestCount" integer DEFAULT 0 NOT NULL,
    "resetRequestWindowStart" timestamp without time zone,
    "failedLoginAttempts" integer DEFAULT 0 NOT NULL,
    "lockUntil" timestamp without time zone,
    "mfaCode" character varying(6),
    "mfaCodeExpiresAt" timestamp without time zone,
    "mfaCodeAttempts" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: user_id_seq; Type: SEQUENCE; Schema: admin; Owner: -
--

CREATE SEQUENCE admin.user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_id_seq; Type: SEQUENCE OWNED BY; Schema: admin; Owner: -
--

ALTER SEQUENCE admin.user_id_seq OWNED BY admin."user".id;


--
-- Name: user_login_logs; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.user_login_logs (
    id bigint NOT NULL,
    "emailIntent" character varying(100),
    success boolean DEFAULT false NOT NULL,
    ip character varying(45),
    user_agent character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id integer
);


--
-- Name: user_login_logs_id_seq; Type: SEQUENCE; Schema: admin; Owner: -
--

CREATE SEQUENCE admin.user_login_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_login_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: admin; Owner: -
--

ALTER SEQUENCE admin.user_login_logs_id_seq OWNED BY admin.user_login_logs.id;


--
-- Name: user_session; Type: TABLE; Schema: admin; Owner: -
--

CREATE TABLE admin.user_session (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    ip character varying(45),
    "userAgent" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "userId" integer
);


--
-- Name: doctors; Type: TABLE; Schema: operativo; Owner: -
--

CREATE TABLE operativo.doctors (
    id integer NOT NULL,
    "firstName" character varying(100) NOT NULL,
    "lastName" character varying(100) NOT NULL,
    "middleName" character varying(100),
    email character varying(150),
    phone character varying(20),
    specialty character varying(150),
    "licenseNumber" character varying(50),
    notes text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: doctors_id_seq; Type: SEQUENCE; Schema: operativo; Owner: -
--

CREATE SEQUENCE operativo.doctors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: doctors_id_seq; Type: SEQUENCE OWNED BY; Schema: operativo; Owner: -
--

ALTER SEQUENCE operativo.doctors_id_seq OWNED BY operativo.doctors.id;


--
-- Name: patients; Type: TABLE; Schema: operativo; Owner: -
--

CREATE TABLE operativo.patients (
    id integer NOT NULL,
    "firstName" character varying(100) NOT NULL,
    "lastName" character varying(100) NOT NULL,
    "middleName" character varying(100),
    "birthDate" date NOT NULL,
    phone character varying(20),
    email character varying(150),
    "addressLine" character varying(255),
    "addressBetween" character varying(255),
    "addressCity" character varying(100),
    "addressState" character varying(100),
    "addressZip" character varying(20),
    "documentType" character varying(20),
    "documentNumber" character varying(50),
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    gender operativo.patients_gender_enum DEFAULT 'other'::operativo.patients_gender_enum NOT NULL
);


--
-- Name: patients_id_seq; Type: SEQUENCE; Schema: operativo; Owner: -
--

CREATE SEQUENCE operativo.patients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patients_id_seq; Type: SEQUENCE OWNED BY; Schema: operativo; Owner: -
--

ALTER SEQUENCE operativo.patients_id_seq OWNED BY operativo.patients.id;


--
-- Name: service_order_items; Type: TABLE; Schema: operativo; Owner: -
--

CREATE TABLE operativo.service_order_items (
    id integer NOT NULL,
    service_order_id integer NOT NULL,
    study_id integer NOT NULL,
    "studyNameSnapshot" character varying(200) NOT NULL,
    "priceType" character varying(20) NOT NULL,
    "unitPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    "discountPercent" numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    "subtotalAmount" numeric(10,2) DEFAULT '0'::numeric NOT NULL
);


--
-- Name: service_order_items_id_seq; Type: SEQUENCE; Schema: operativo; Owner: -
--

CREATE SEQUENCE operativo.service_order_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: operativo; Owner: -
--

ALTER SEQUENCE operativo.service_order_items_id_seq OWNED BY operativo.service_order_items.id;


--
-- Name: service_orders; Type: TABLE; Schema: operativo; Owner: -
--

CREATE TABLE operativo.service_orders (
    id integer NOT NULL,
    folio character varying(50) NOT NULL,
    patient_id integer NOT NULL,
    doctor_id integer,
    "branchName" character varying(150),
    "sampleAt" timestamp without time zone,
    "deliveryAt" timestamp without time zone,
    "subtotalAmount" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "courtesyPercent" numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    "discountAmount" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "totalAmount" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    status operativo.service_orders_status_enum DEFAULT 'pending'::operativo.service_orders_status_enum NOT NULL
);


--
-- Name: service_orders_id_seq; Type: SEQUENCE; Schema: operativo; Owner: -
--

CREATE SEQUENCE operativo.service_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: operativo; Owner: -
--

ALTER SEQUENCE operativo.service_orders_id_seq OWNED BY operativo.service_orders.id;


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
-- Name: study_details; Type: TABLE; Schema: operativo; Owner: -
--

CREATE TABLE operativo.study_details (
    id integer NOT NULL,
    study_id integer NOT NULL,
    parent_id integer,
    name character varying(150) NOT NULL,
    "sortOrder" integer DEFAULT 1 NOT NULL,
    unit character varying(50),
    "referenceValue" character varying(255),
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "dataType" operativo.study_details_datatype_enum NOT NULL
);


--
-- Name: study_details_id_seq; Type: SEQUENCE; Schema: operativo; Owner: -
--

CREATE SEQUENCE operativo.study_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_details_id_seq; Type: SEQUENCE OWNED BY; Schema: operativo; Owner: -
--

ALTER SEQUENCE operativo.study_details_id_seq OWNED BY operativo.study_details.id;


--
-- Name: study_result_values; Type: TABLE; Schema: operativo; Owner: -
--

CREATE TABLE operativo.study_result_values (
    id integer NOT NULL,
    study_result_id integer NOT NULL,
    study_detail_id integer,
    label character varying(150) NOT NULL,
    unit character varying(50),
    "referenceValue" character varying(255),
    value character varying(100),
    "sortOrder" integer DEFAULT 1 NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: study_result_values_id_seq; Type: SEQUENCE; Schema: operativo; Owner: -
--

CREATE SEQUENCE operativo.study_result_values_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_result_values_id_seq; Type: SEQUENCE OWNED BY; Schema: operativo; Owner: -
--

ALTER SEQUENCE operativo.study_result_values_id_seq OWNED BY operativo.study_result_values.id;


--
-- Name: study_results; Type: TABLE; Schema: operativo; Owner: -
--

CREATE TABLE operativo.study_results (
    id integer NOT NULL,
    service_order_id integer NOT NULL,
    service_order_item_id integer NOT NULL,
    "sampleAt" timestamp without time zone,
    "reportedAt" timestamp without time zone,
    method character varying(150),
    observations text,
    "isDraft" boolean DEFAULT true NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: study_results_id_seq; Type: SEQUENCE; Schema: operativo; Owner: -
--

CREATE SEQUENCE operativo.study_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_results_id_seq; Type: SEQUENCE OWNED BY; Schema: operativo; Owner: -
--

ALTER SEQUENCE operativo.study_results_id_seq OWNED BY operativo.study_results.id;


--
-- Name: doctors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctors (
    id integer NOT NULL,
    "firstName" character varying(100) NOT NULL,
    "lastName" character varying(100) NOT NULL,
    "middleName" character varying(100),
    email character varying(150),
    phone character varying(20),
    specialty character varying(150),
    "licenseNumber" character varying(50),
    notes text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: doctors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.doctors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: doctors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.doctors_id_seq OWNED BY public.doctors.id;


--
-- Name: patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patients (
    id integer NOT NULL,
    "firstName" character varying(100) NOT NULL,
    "lastName" character varying(100) NOT NULL,
    "middleName" character varying(100),
    gender public.patients_gender_enum NOT NULL,
    "birthDate" date NOT NULL,
    phone character varying(20),
    email character varying(150),
    "addressLine" character varying(255),
    "addressBetween" character varying(255),
    "addressCity" character varying(100),
    "addressState" character varying(100),
    "addressZip" character varying(20),
    "documentType" character varying(20),
    "documentNumber" character varying(50),
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: patients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patients_id_seq OWNED BY public.patients.id;


--
-- Name: service_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_order_items (
    id integer NOT NULL,
    service_order_id integer NOT NULL,
    study_id integer NOT NULL,
    "studyNameSnapshot" character varying(200) NOT NULL,
    "priceType" character varying(20) NOT NULL,
    "unitPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    "discountPercent" numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    "subtotalAmount" numeric(10,2) DEFAULT '0'::numeric NOT NULL
);


--
-- Name: service_order_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_order_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_order_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_order_items_id_seq OWNED BY public.service_order_items.id;


--
-- Name: service_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_orders (
    id integer NOT NULL,
    folio character varying(50) NOT NULL,
    patient_id integer NOT NULL,
    doctor_id integer,
    "branchName" character varying(150),
    "sampleAt" timestamp without time zone,
    "deliveryAt" timestamp without time zone,
    status public.service_orders_status_enum DEFAULT 'pending'::public.service_orders_status_enum NOT NULL,
    "subtotalAmount" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "courtesyPercent" numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    "discountAmount" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "totalAmount" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: service_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_orders_id_seq OWNED BY public.service_orders.id;


--
-- Name: studies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studies (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    code character varying(50) NOT NULL,
    description text,
    "durationMinutes" integer DEFAULT 60 NOT NULL,
    type public.studies_type_enum DEFAULT 'study'::public.studies_type_enum NOT NULL,
    "normalPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "difPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "specialPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "hospitalPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "otherPrice" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    "defaultDiscountPercent" numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    method character varying(150),
    indicator character varying(150),
    status public.studies_status_enum DEFAULT 'active'::public.studies_status_enum NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: studies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.studies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: studies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.studies_id_seq OWNED BY public.studies.id;


--
-- Name: study_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_details (
    id integer NOT NULL,
    study_id integer NOT NULL,
    parent_id integer,
    "dataType" public.study_details_datatype_enum NOT NULL,
    name character varying(150) NOT NULL,
    "sortOrder" integer DEFAULT 1 NOT NULL,
    unit character varying(50),
    "referenceValue" character varying(255),
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: study_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_details_id_seq OWNED BY public.study_details.id;


--
-- Name: study_result_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_result_values (
    id integer NOT NULL,
    study_result_id integer NOT NULL,
    study_detail_id integer,
    label character varying(150) NOT NULL,
    unit character varying(50),
    "referenceValue" character varying(255),
    value character varying(100),
    "sortOrder" integer DEFAULT 1 NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: study_result_values_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_result_values_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_result_values_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_result_values_id_seq OWNED BY public.study_result_values.id;


--
-- Name: study_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_results (
    id integer NOT NULL,
    service_order_id integer NOT NULL,
    service_order_item_id integer NOT NULL,
    "sampleAt" timestamp without time zone,
    "reportedAt" timestamp without time zone,
    method character varying(150),
    observations text,
    "isDraft" boolean DEFAULT true NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: study_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.study_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: study_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.study_results_id_seq OWNED BY public.study_results.id;


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    email character varying(50) NOT NULL,
    password character varying(60) NOT NULL,
    token character varying(6),
    confirmed boolean DEFAULT false NOT NULL,
    rol public.user_rol_enum DEFAULT 'admin'::public.user_rol_enum NOT NULL,
    "resetTokenExpiresAt" timestamp without time zone,
    "resetRequestCount" integer DEFAULT 0 NOT NULL,
    "resetRequestWindowStart" timestamp without time zone,
    "failedLoginAttempts" integer DEFAULT 0 NOT NULL,
    "lockUntil" timestamp without time zone,
    "mfaCode" character varying(6),
    "mfaCodeExpiresAt" timestamp without time zone,
    "mfaCodeAttempts" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_id_seq OWNED BY public."user".id;


--
-- Name: user_login_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_login_logs (
    id bigint NOT NULL,
    "emailIntent" character varying(100),
    success boolean DEFAULT false NOT NULL,
    ip character varying(45),
    user_agent character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id integer
);


--
-- Name: user_login_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_login_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_login_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_login_logs_id_seq OWNED BY public.user_login_logs.id;


--
-- Name: user_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_session (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    ip character varying(45),
    "userAgent" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "userId" integer
);


--
-- Name: user id; Type: DEFAULT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin."user" ALTER COLUMN id SET DEFAULT nextval('admin.user_id_seq'::regclass);


--
-- Name: user_login_logs id; Type: DEFAULT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.user_login_logs ALTER COLUMN id SET DEFAULT nextval('admin.user_login_logs_id_seq'::regclass);


--
-- Name: doctors id; Type: DEFAULT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.doctors ALTER COLUMN id SET DEFAULT nextval('operativo.doctors_id_seq'::regclass);


--
-- Name: patients id; Type: DEFAULT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.patients ALTER COLUMN id SET DEFAULT nextval('operativo.patients_id_seq'::regclass);


--
-- Name: service_order_items id; Type: DEFAULT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.service_order_items ALTER COLUMN id SET DEFAULT nextval('operativo.service_order_items_id_seq'::regclass);


--
-- Name: service_orders id; Type: DEFAULT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.service_orders ALTER COLUMN id SET DEFAULT nextval('operativo.service_orders_id_seq'::regclass);


--
-- Name: studies id; Type: DEFAULT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.studies ALTER COLUMN id SET DEFAULT nextval('operativo.studies_id_seq'::regclass);


--
-- Name: study_details id; Type: DEFAULT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_details ALTER COLUMN id SET DEFAULT nextval('operativo.study_details_id_seq'::regclass);


--
-- Name: study_result_values id; Type: DEFAULT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_result_values ALTER COLUMN id SET DEFAULT nextval('operativo.study_result_values_id_seq'::regclass);


--
-- Name: study_results id; Type: DEFAULT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_results ALTER COLUMN id SET DEFAULT nextval('operativo.study_results_id_seq'::regclass);


--
-- Name: doctors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctors ALTER COLUMN id SET DEFAULT nextval('public.doctors_id_seq'::regclass);


--
-- Name: patients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients ALTER COLUMN id SET DEFAULT nextval('public.patients_id_seq'::regclass);


--
-- Name: service_order_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_items ALTER COLUMN id SET DEFAULT nextval('public.service_order_items_id_seq'::regclass);


--
-- Name: service_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders ALTER COLUMN id SET DEFAULT nextval('public.service_orders_id_seq'::regclass);


--
-- Name: studies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies ALTER COLUMN id SET DEFAULT nextval('public.studies_id_seq'::regclass);


--
-- Name: study_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_details ALTER COLUMN id SET DEFAULT nextval('public.study_details_id_seq'::regclass);


--
-- Name: study_result_values id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_result_values ALTER COLUMN id SET DEFAULT nextval('public.study_result_values_id_seq'::regclass);


--
-- Name: study_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_results ALTER COLUMN id SET DEFAULT nextval('public.study_results_id_seq'::regclass);


--
-- Name: user id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user" ALTER COLUMN id SET DEFAULT nextval('public.user_id_seq'::regclass);


--
-- Name: user_login_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_login_logs ALTER COLUMN id SET DEFAULT nextval('public.user_login_logs_id_seq'::regclass);


--
-- Data for Name: user; Type: TABLE DATA; Schema: admin; Owner: -
--

COPY admin."user" (id, nombre, email, password, token, confirmed, rol, "resetTokenExpiresAt", "resetRequestCount", "resetRequestWindowStart", "failedLoginAttempts", "lockUntil", "mfaCode", "mfaCodeExpiresAt", "mfaCodeAttempts", "createdAt", "updatedAt") FROM stdin;
8	KRISTOFER JOSAFAT TAPIA HERNANDEZ	20230005@uthh.edu.mx	$2b$10$zRqzP2q6WOBL.I95iKHY..w4Cpgxb/2qxtTZx6IqeWGmqpaL3dAaC	\N	t	admin	\N	0	\N	0	\N	\N	\N	0	2026-01-28 03:35:18.631342	2026-01-28 03:35:18.631342
9	OWASP	2023005@uthh.edu.mx	$2b$10$IrSPwsisfY.3vsJngO6C8uC1KweYdT.R6sHxPWjvbnVCnQ3ph9GRa	342375	f	admin	\N	0	\N	0	\N	\N	\N	0	2026-01-28 23:16:40.663533	2026-01-28 23:16:40.663533
12	peyan	peyan91264@iaciu.com	$2b$10$3BgBh0M3yNgdbKnnMXKkX.iTi2dVUz7XhgafNvKeTbLu53/WL0xz2		t	admin	\N	0	\N	3	2026-02-18 18:35:22.23	\N	\N	0	2026-02-16 23:14:51.079962	2026-02-19 00:20:24.408788
10	OWASP	20230051@uthh.edu.mx	$2b$10$cI5LcD61dSIuPo.VoeCvq.3PKdq6mYcP6JCvvpMpydaL3cm.FsOuK	\N	t	admin	\N	0	\N	0	\N	\N	\N	0	2026-01-28 23:19:39.856494	2026-01-28 23:21:07.067873
13	Jos	kacajaj209@fentaoba.com	$2b$10$SyfzHktx5IVD7LqKHLiu7.WxF.uCbwK9hGM/tedxbbkUz7yXpj1pW	\N	t	admin	\N	0	\N	0	\N	\N	\N	0	2026-02-19 00:24:05.19087	2026-02-19 00:41:24.759293
11	OWASP	20221087@uthh.edu.mx	$2b$10$ugB8EGRgXJQo6U6lJngAOO89BEdDUcmYHeS/gh.sqW4/EYWEBDuIy	\N	t	admin	\N	0	\N	3	2026-01-29 00:12:06.061	\N	\N	0	2026-01-28 23:32:43.05779	2026-01-28 23:59:10.155008
7	Josafat Tapia	losiw48346@okexbit.com	$2b$10$K5C9Wc4XtpC.M8F702lYGuuQnpiGfsr6FHHCGGMnC5gpHdZSF5e6i	\N	t	admin	\N	0	\N	1	\N	787150	2026-01-30 18:54:01.025	0	2026-01-27 17:46:51.742793	2026-02-16 23:26:26.909724
1	Juan Perez	xejana2096@naprb.com	$2b$10$uA/F5ND9qA7s4j75rnSS6eoV3EPLr4IkgFSc2Hv7Z3JzoVsd.EM8u	\N	t	admin	\N	0	\N	0	\N	354925	2026-01-19 22:04:40.643	0	2026-01-20 03:41:51.671863	2026-01-20 15:56:19.805609
2	Admin Econolab	econolab.huejutla@gmail.com	$2b$10$h6fR62cMFIxpdEsszqlZG.v4WRHRGa6hRwG6I3UVIsocVGcCeQA2m	\N	t	admin	\N	0	\N	0	\N	\N	\N	0	2026-01-20 04:02:19.862454	2026-01-20 16:08:14.433472
4	Jesus David Saldaña Hernández	davidsaldana052@gmail.com	$2b$10$ZQKQtaOWYIuVvRkBd0H7Re1YnK.4Fam.C7BsiQruYHMs6fSzzE2Hy	\N	t	admin	\N	0	\N	0	\N	\N	\N	0	2026-01-27 03:12:09.872621	2026-01-27 03:12:09.872621
5	Admin	Davidsaldana052@gmail.com	$2b$10$oDg9AFoLl9.klaRH0Exoh.ARLa7rmkhV60SC4iRH9U6aC.hllV3.S	504976	f	admin	\N	0	\N	0	\N	\N	\N	0	2026-01-27 03:57:35.646524	2026-01-27 03:57:35.646524
6	Admin	yevih83771@juhxs.com	$2b$10$wEpkMcEtaJ2k5H4QgWmph.nJNQbIj7wqDmoCwMbrD1nqXvkQ2krMa	178900	f	admin	\N	0	\N	0	\N	\N	\N	0	2026-01-27 03:59:29.077821	2026-01-27 03:59:29.077821
14	Prueba	hoyamed927@pazuric.com	$2b$10$KYVnbC6qcZMQU3H9KEljHOTYD4eju5KQoYDCi8jZ7N1vCUAbazliS	\N	t	admin	\N	0	\N	0	\N	\N	\N	0	2026-02-27 17:32:32.146293	2026-02-27 18:53:09.356696
3	Kristofer Josafat Tapia Hernández	kristotapia9896@gmail.com	$2b$10$MBGaqVqMEEkhH0k9d.D9KOJyM5ms.WHVYpkSKIfjQW8MxwiCFezzG	\N	t	admin	\N	0	\N	4	2026-02-18 18:33:24.81	\N	\N	0	2026-01-26 22:41:18.016367	2026-02-19 00:18:25.191412
\.


--
-- Data for Name: user_login_logs; Type: TABLE DATA; Schema: admin; Owner: -
--

COPY admin.user_login_logs (id, "emailIntent", success, ip, user_agent, created_at, user_id) FROM stdin;
1	\N	t	::1	node	2026-01-20 15:13:57.9353+00	2
2	\N	t	::1	node	2026-01-20 15:17:46.266252+00	2
3	econolab.huejutla@gmail.com	f	::1	node	2026-01-20 15:21:20.952845+00	\N
4	econolab.huejutla@gmail.com	f	::1	node	2026-01-20 15:23:26.170475+00	\N
5	econolab.huejutla@gmail.com	f	::1	node	2026-01-20 15:23:43.445149+00	\N
6	\N	t	::1	node	2026-01-20 15:26:35.174631+00	2
7	\N	t	::1	node	2026-01-20 15:38:38.992691+00	2
8	\N	t	::1	node	2026-01-20 16:08:15.01171+00	2
9	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-26 22:41:19.02628+00	3
10	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-26 22:59:15.606398+00	3
11	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-27 03:12:10.504606+00	4
12	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-27 03:18:37.471985+00	4
13	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-27 03:20:23.442904+00	4
14	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-27 03:25:40.51303+00	4
15	Davidsaldana052@gmail.com	f	::1	PostmanRuntime/7.51.0	2026-01-27 03:57:10.360303+00	\N
16	\N	t	::1	node	2026-01-27 17:47:52.462758+00	7
17	kristotapia9896@gmail.com	f	::1	node	2026-01-28 03:29:00.805187+00	\N
18	\N	t	::1	node	2026-01-28 03:29:19.416889+00	7
19	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-28 03:35:18.732237+00	8
20	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-28 03:35:20.076931+00	2
21	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-28 03:35:33.043869+00	3
22	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-28 03:35:42.858179+00	3
23	\N	t	::1	node	2026-01-28 23:21:07.169099+00	10
24	20221087@uthh.edu.mx	f	::1	node	2026-01-28 23:34:27.558651+00	\N
25	20221087@uthh.edu.mx	f	::1	node	2026-01-28 23:35:47.154693+00	\N
26	202210sdad87@uthh.edu.mx	f	::1	node	2026-01-28 23:37:02.337213+00	\N
27	202dsfs21087@uthh.edu.mx	f	::1	node	2026-01-28 23:37:14.235423+00	\N
28	\N	t	::1	node	2026-01-28 23:50:39.246538+00	11
29	20221087@uthh.edu.mx	f	::1	node	2026-01-28 23:57:06.171733+00	\N
30	20221087@uthh.edu.mx	f	::1	node	2026-01-28 23:57:21.310981+00	\N
31	20221087@uthh.edu.mx	f	::1	node	2026-01-28 23:57:42.675913+00	\N
32	20221087@uthh.edu.mx	f	::1	node	2026-01-28 23:59:23.545664+00	\N
33	20221087@uthh.edu.mx	f	::1	node	2026-01-29 00:00:31.021403+00	\N
34	20221087@uthh.edu.mx	f	::1	node	2026-01-29 00:04:03.101254+00	\N
35	20221087@uthh.edu.mx	f	::1	node	2026-01-29 00:07:34.729703+00	\N
36	20221087@uthh.edu.mx	f	::1	node	2026-01-29 00:10:22.509655+00	\N
37	20221087@uthh.edu.mx	f	::1	node	2026-01-29 00:10:22.636016+00	\N
38	20221087@uthh.edu.mx	f	::1	node	2026-01-29 00:10:22.94949+00	\N
39	20221087@uthh.edu.mx	f	::1	node	2026-01-29 00:10:23.346099+00	\N
40	20221087@uthh.edu.mx	f	::1	node	2026-01-29 00:10:25.717361+00	\N
41	20221087@uthh.edu.mx	f	::1	node	2026-01-29 00:10:25.73979+00	\N
42	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-30 18:35:01.029834+00	3
43	kristotapia9896@gmail.com	f	::1	node	2026-01-30 18:48:57.528437+00	\N
44	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-30 18:49:10.0411+00	3
45	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-30 21:47:51.878445+00	3
46	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-30 22:06:54.508029+00	3
47	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-02-04 23:24:15.477812+00	3
48	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36	2026-02-16 23:12:11.3437+00	3
49	kristotapia9896@gmail.com	f	::1	node	2026-02-16 23:13:00.70916+00	\N
50	yegayi3810@noihse.com	f	::1	node	2026-02-16 23:13:15.45927+00	\N
51	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36	2026-02-16 23:13:46.679415+00	3
52	losiw48346@okexbit.com	f	::1	node	2026-02-16 23:26:27.531277+00	\N
53	peyan91264@iaciu.com	f	::1	node	2026-02-16 23:27:12.463038+00	\N
54	\N	t	::1	node	2026-02-16 23:35:30.161708+00	12
55	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36	2026-02-16 23:44:05.054634+00	3
56	\N	t	::1	node	2026-02-16 23:44:57.244106+00	12
57	kristotapia9896@gmail.com	f	::1	node	2026-02-19 00:18:26.030442+00	\N
58	peyan91264@iaciu.com	f	::1	node	2026-02-19 00:19:49.637641+00	\N
59	peyan91264@iaciu.com	f	::1	node	2026-02-19 00:20:26.208612+00	\N
60	peyan91264@iaciu.com	f	::1	node	2026-02-19 00:21:26.429956+00	\N
61	peyan91264@iaciu.com	f	::1	node	2026-02-19 00:22:41.000641+00	\N
62	peyan91264@iaciu.com	f	::1	node	2026-02-19 00:23:13.32036+00	\N
63	\N	t	::1	node	2026-02-19 00:25:35.450726+00	13
64	\N	t	::1	node	2026-02-19 00:41:26.039531+00	13
65	\N	t	::1	node	2026-02-27 17:34:41.985326+00	14
66	\N	t	::1	node	2026-02-27 17:59:50.812566+00	14
67	\N	t	::1	node	2026-02-27 18:21:22.984886+00	14
68	\N	t	::1	node	2026-02-27 18:31:32.436127+00	14
69	hoyamed927@pazuric.com	f	::1	node	2026-02-27 18:52:07.560283+00	\N
70	hoyamed927@pazuric.com	f	::1	node	2026-02-27 18:52:44.508403+00	\N
71	\N	t	::1	node	2026-02-27 18:53:14.167538+00	14
\.


--
-- Data for Name: user_session; Type: TABLE DATA; Schema: admin; Owner: -
--

COPY admin.user_session (id, "expiresAt", revoked, ip, "userAgent", "createdAt", "userId") FROM stdin;
1008eb64-aa59-4c4f-b701-5010c69b4b57	2026-01-20 09:28:57.542	f	::1	node	2026-01-20 15:13:57.646607	2
e439c2a1-a377-4c34-aa1f-2162660d71f2	2026-01-20 09:32:45.878	f	::1	node	2026-01-20 15:17:45.985534	2
87ba97b0-a5ca-47ef-9053-17b3f56e502f	2026-01-20 09:41:34.781	f	::1	node	2026-01-20 15:26:34.892018	2
1f9b0b8a-44fa-4685-bfc9-cb98514e066d	2026-01-20 09:53:38.597	f	::1	node	2026-01-20 15:38:38.712985	2
caf91e59-84f6-4803-8a0e-9e53f5707c09	2026-01-20 10:23:14.586	f	::1	node	2026-01-20 16:08:14.715993	2
47d032f7-b26e-477c-83c2-02fa935ea114	2026-01-26 16:56:18.29	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-26 22:41:18.516247	3
03f53cc7-efe4-49e1-94ba-0dccf539b9bd	2026-01-26 17:14:14.996	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-26 22:59:15.20648	3
cae837b2-79fb-4ec2-9bba-dcd0810f712c	2026-01-26 21:27:10.855	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-27 03:12:10.18314	4
b89fa5a9-5fdf-4471-93c3-c1aca5847288	2026-01-26 21:33:37.805	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-27 03:18:37.137688	4
88cd3b5f-156a-4ea7-a147-9abc317eb863	2026-01-26 21:35:23.824	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-27 03:20:23.15215	4
adb33837-d6fe-4908-a3e9-dbb1ec061637	2026-01-26 21:40:40.872	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-27 03:25:40.209217	4
b20cd353-0434-4238-8b24-78f053b0f32b	2026-01-27 18:02:52.435	f	::1	node	2026-01-27 17:47:52.437786	7
a6b33954-6a39-4950-98f9-2362b3d04bfc	2026-01-28 03:44:19.397	f	::1	node	2026-01-28 03:29:19.399167	7
b99fed38-d08e-43bb-9ad5-912906b4bd99	2026-01-28 03:50:18.72	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-28 03:35:18.721189	8
81842c01-1441-46a1-8e15-7fe0030894eb	2026-01-28 03:50:20.069	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-28 03:35:20.069878	2
392815e6-e6ba-449e-8768-890a75844b7f	2026-01-28 03:50:33.036	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-28 03:35:33.03686	3
32de6404-4c3a-4837-9e19-0dcb37b058d7	2026-01-28 03:50:42.85	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-28 03:35:42.850989	3
18eef1e0-484a-43f3-830b-5004534f5995	2026-01-28 23:36:07.073	f	::1	node	2026-01-28 23:21:07.074267	10
0ed33f41-56a3-43c8-aec0-cd6eebc5b969	2026-01-29 00:05:39.176	f	::1	node	2026-01-28 23:50:39.176576	11
e2dc63c7-2259-47b3-b392-dc04825a8096	2026-01-30 18:50:00.926	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-30 18:35:00.928174	3
185096b0-17b6-46dc-9c9b-907a3bfd4553	2026-01-30 19:04:10.024	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-30 18:49:10.024326	3
1f5295ab-1120-44f9-80a6-4fb89d2f14c2	2026-01-30 22:02:51.776	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-30 21:47:51.779549	3
484ec4b8-b652-43ff-bd63-829655f436c1	2026-01-30 22:21:54.416	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-01-30 22:06:54.418916	3
e82d3288-a412-45c2-b5cd-1c60b2b087a8	2026-02-04 23:39:15.435	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36	2026-02-04 23:24:15.439572	3
161a9e63-af8f-4e8d-9201-859dba7c21d3	2026-02-16 17:27:10.376	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36	2026-02-16 23:12:10.649402	3
bd2e984a-6567-4c49-bdd9-8df1724fd5f0	2026-02-16 17:28:45.79	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36	2026-02-16 23:13:46.050024	3
45db03c8-98b0-4d72-8934-ae2aa224f05e	2026-02-16 17:50:29.025	f	::1	node	2026-02-16 23:35:29.336634	12
e48b8fd7-0a76-4532-8c4d-9bf2211a1edc	2026-02-16 17:59:04.186	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36	2026-02-16 23:44:04.502601	3
1af4c551-5313-4e2e-ba11-3d1c16b79f9d	2026-02-16 17:59:56.432	f	::1	node	2026-02-16 23:44:56.776379	12
157077f8-6a3e-4659-8c29-6f0d7a5ea917	2026-02-18 18:40:34.409	f	::1	node	2026-02-19 00:25:34.480851	13
11fc9ce0-a29c-4eef-9c4c-f134a55b8f97	2026-02-18 18:56:25.297	f	::1	node	2026-02-19 00:41:25.389298	13
7bfdebc2-9280-4923-a376-6fed3f3869c3	2026-02-27 11:49:39.744	f	::1	node	2026-02-27 17:34:41.069359	14
c4644ff1-dd10-4833-a89b-c29697746e35	2026-02-27 12:14:47.993	f	::1	node	2026-02-27 17:59:49.338632	14
013f82b5-45b6-4e26-b8d1-7942782f920d	2026-02-27 12:36:20.614	f	::1	node	2026-02-27 18:21:21.991941	14
ebe58c6d-5583-46e4-9db7-028c00dfb2e5	2026-02-27 12:46:30.21	f	::1	node	2026-02-27 18:31:31.611251	14
a747b921-8f35-4301-8e92-a2266613d307	2026-02-27 13:08:10.023	f	::1	node	2026-02-27 18:53:11.448509	14
\.


--
-- Data for Name: doctors; Type: TABLE DATA; Schema: operativo; Owner: -
--

COPY operativo.doctors (id, "firstName", "lastName", "middleName", email, phone, specialty, "licenseNumber", notes, "isActive", "createdAt", "updatedAt") FROM stdin;
1	VICTOR	VALDIVIA	MARTINEZ	vitol@vitol.com	7711945508	Quimico	si	\N	t	2026-02-16 23:46:04.103377	2026-02-16 23:46:04.103377
\.


--
-- Data for Name: patients; Type: TABLE DATA; Schema: operativo; Owner: -
--

COPY operativo.patients (id, "firstName", "lastName", "middleName", "birthDate", phone, email, "addressLine", "addressBetween", "addressCity", "addressState", "addressZip", "documentType", "documentNumber", "isActive", "createdAt", "updatedAt", gender) FROM stdin;
1	JOSE	CASTRO	ROSAS	2006-02-16	7711901940	castro@castro.com	el cerro	\N	Hidalgo	\N	\N	\N	\N	t	2026-02-16 23:47:38.459041	2026-02-16 23:47:38.459041	other
2	JOSE	HERNANDEZ	HERNANDEZ	2006-02-18	7788994455	finejeg562@lovleo.com	centro	\N	Huejutla	\N	\N	\N	\N	t	2026-02-19 00:37:30.603901	2026-02-19 00:37:30.603901	other
\.


--
-- Data for Name: service_order_items; Type: TABLE DATA; Schema: operativo; Owner: -
--

COPY operativo.service_order_items (id, service_order_id, study_id, "studyNameSnapshot", "priceType", "unitPrice", quantity, "discountPercent", "subtotalAmount") FROM stdin;
1	1	1	GLUCOSA	normal	110.00	1	0.00	110.00
2	2	1	GLUCOSA	normal	110.00	1	0.00	110.00
\.


--
-- Data for Name: service_orders; Type: TABLE DATA; Schema: operativo; Owner: -
--

COPY operativo.service_orders (id, folio, patient_id, doctor_id, "branchName", "sampleAt", "deliveryAt", "subtotalAmount", "courtesyPercent", "discountAmount", "totalAmount", notes, "isActive", "createdAt", "updatedAt", status) FROM stdin;
1	NUM-001	1	1	Matriz - Centro	\N	2026-02-18 08:00:00	110.00	0.00	0.00	110.00	\N	t	2026-02-16 23:50:36.781893	2026-02-16 23:50:36.781893	pending
2	GLU-002	2	1	Matriz - Centro	\N	2026-02-26 08:00:00	110.00	0.00	0.00	110.00	\N	t	2026-02-19 00:42:25.862434	2026-02-19 00:42:25.862434	pending
\.


--
-- Data for Name: studies; Type: TABLE DATA; Schema: operativo; Owner: -
--

COPY operativo.studies (id, name, code, description, "durationMinutes", "normalPrice", "difPrice", "specialPrice", "hospitalPrice", "otherPrice", "defaultDiscountPercent", method, indicator, "isActive", "createdAt", "updatedAt", type, status) FROM stdin;
1	GLUCOSA	GLU-001	Estudio de glucosa	60	110.00	80.00	90.00	140.00	150.00	0.00	\N	\N	t	2026-02-16 23:49:15.700267	2026-02-16 23:49:15.700267	study	active
\.


--
-- Data for Name: study_details; Type: TABLE DATA; Schema: operativo; Owner: -
--

COPY operativo.study_details (id, study_id, parent_id, name, "sortOrder", unit, "referenceValue", "isActive", "createdAt", "updatedAt", "dataType") FROM stdin;
\.


--
-- Data for Name: study_result_values; Type: TABLE DATA; Schema: operativo; Owner: -
--

COPY operativo.study_result_values (id, study_result_id, study_detail_id, label, unit, "referenceValue", value, "sortOrder", visible, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: study_results; Type: TABLE DATA; Schema: operativo; Owner: -
--

COPY operativo.study_results (id, service_order_id, service_order_item_id, "sampleAt", "reportedAt", method, observations, "isDraft", "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: doctors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.doctors (id, "firstName", "lastName", "middleName", email, phone, specialty, "licenseNumber", notes, "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: patients; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.patients (id, "firstName", "lastName", "middleName", gender, "birthDate", phone, email, "addressLine", "addressBetween", "addressCity", "addressState", "addressZip", "documentType", "documentNumber", "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: service_order_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.service_order_items (id, service_order_id, study_id, "studyNameSnapshot", "priceType", "unitPrice", quantity, "discountPercent", "subtotalAmount") FROM stdin;
\.


--
-- Data for Name: service_orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.service_orders (id, folio, patient_id, doctor_id, "branchName", "sampleAt", "deliveryAt", status, "subtotalAmount", "courtesyPercent", "discountAmount", "totalAmount", notes, "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: studies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.studies (id, name, code, description, "durationMinutes", type, "normalPrice", "difPrice", "specialPrice", "hospitalPrice", "otherPrice", "defaultDiscountPercent", method, indicator, status, "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: study_details; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.study_details (id, study_id, parent_id, "dataType", name, "sortOrder", unit, "referenceValue", "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: study_result_values; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.study_result_values (id, study_result_id, study_detail_id, label, unit, "referenceValue", value, "sortOrder", visible, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: study_results; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.study_results (id, service_order_id, service_order_item_id, "sampleAt", "reportedAt", method, observations, "isDraft", "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: user; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public."user" (id, nombre, email, password, token, confirmed, rol, "resetTokenExpiresAt", "resetRequestCount", "resetRequestWindowStart", "failedLoginAttempts", "lockUntil", "mfaCode", "mfaCodeExpiresAt", "mfaCodeAttempts", "createdAt", "updatedAt") FROM stdin;
2	Kristofer Josafat Tapia Hernández	kristotapia9896@gmail.com	$2b$10$RBgrzgGDLG9Q/b6wouY8hu1J5W9DZBE/vqZg95mpfx7PTP9pPpelu	\N	t	admin	\N	0	\N	0	\N	\N	\N	0	2026-03-08 23:30:07.605036	2026-03-08 23:30:07.605036
1	Yimodil	yivotil238@medevsa.com	$2b$10$JAGcdokDVQ7AaVAZjz9F8eI7bzQpWtcudMiA6jO2rPEPjTLoSV6L2	\N	t	admin	\N	0	\N	0	\N	\N	\N	0	2026-03-04 03:51:09.031511	2026-03-08 23:30:31.295934
\.


--
-- Data for Name: user_login_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_login_logs (id, "emailIntent", success, ip, user_agent, created_at, user_id) FROM stdin;
1	\N	t	::1	node	2026-03-04 03:51:47.59387+00	1
2	\N	t	::1	node	2026-03-04 04:02:51.099091+00	1
3	\N	t	::1	node	2026-03-04 04:33:27.824404+00	1
4	\N	t	::1	node	2026-03-04 04:49:11.736459+00	1
5	\N	t	::1	node	2026-03-04 04:57:15.026623+00	1
6	\N	t	::1	node	2026-03-06 00:31:06.705316+00	1
7	\N	t	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36	2026-03-08 23:30:08.166044+00	2
8	\N	t	::1	node	2026-03-08 23:30:31.795987+00	1
\.


--
-- Data for Name: user_session; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_session (id, "expiresAt", revoked, ip, "userAgent", "createdAt", "userId") FROM stdin;
6663b3a5-de8b-4f8e-9432-883007eee587	2026-03-03 22:06:46.321	f	::1	node	2026-03-04 03:51:47.314978	1
087f19a1-2c75-41c4-b811-d5c03eeda7b0	2026-03-03 22:17:49.837	f	::1	node	2026-03-04 04:02:50.84588	1
54024e26-946b-4b57-b362-5303c1b7b953	2026-03-03 22:48:26.494	f	::1	node	2026-03-04 04:33:27.546546	1
37ec52c2-9170-4993-b4fc-af2e3b0ac4f4	2026-03-03 23:04:10.392	f	::1	node	2026-03-04 04:49:11.465833	1
59eee721-294c-475d-bd47-30cc14fac333	2026-03-03 23:12:13.655	f	::1	node	2026-03-04 04:57:14.744099	1
0e89ea47-b67b-460a-895d-475c54ab000f	2026-03-05 18:46:03.173	f	::1	node	2026-03-06 00:31:06.085535	1
19ba5e8f-5874-458b-8df5-db5114a82d5e	2026-03-08 17:45:07.482	f	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36	2026-03-08 23:30:07.883143	2
c0fd884f-e31b-45db-bd3b-fa3aaa26ece5	2026-03-08 17:45:31.141	f	::1	node	2026-03-08 23:30:31.542003	1
\.


--
-- Name: user_id_seq; Type: SEQUENCE SET; Schema: admin; Owner: -
--

SELECT pg_catalog.setval('admin.user_id_seq', 14, true);


--
-- Name: user_login_logs_id_seq; Type: SEQUENCE SET; Schema: admin; Owner: -
--

SELECT pg_catalog.setval('admin.user_login_logs_id_seq', 71, true);


--
-- Name: doctors_id_seq; Type: SEQUENCE SET; Schema: operativo; Owner: -
--

SELECT pg_catalog.setval('operativo.doctors_id_seq', 1, true);


--
-- Name: patients_id_seq; Type: SEQUENCE SET; Schema: operativo; Owner: -
--

SELECT pg_catalog.setval('operativo.patients_id_seq', 2, true);


--
-- Name: service_order_items_id_seq; Type: SEQUENCE SET; Schema: operativo; Owner: -
--

SELECT pg_catalog.setval('operativo.service_order_items_id_seq', 2, true);


--
-- Name: service_orders_id_seq; Type: SEQUENCE SET; Schema: operativo; Owner: -
--

SELECT pg_catalog.setval('operativo.service_orders_id_seq', 2, true);


--
-- Name: studies_id_seq; Type: SEQUENCE SET; Schema: operativo; Owner: -
--

SELECT pg_catalog.setval('operativo.studies_id_seq', 1, true);


--
-- Name: study_details_id_seq; Type: SEQUENCE SET; Schema: operativo; Owner: -
--

SELECT pg_catalog.setval('operativo.study_details_id_seq', 1, false);


--
-- Name: study_result_values_id_seq; Type: SEQUENCE SET; Schema: operativo; Owner: -
--

SELECT pg_catalog.setval('operativo.study_result_values_id_seq', 1, false);


--
-- Name: study_results_id_seq; Type: SEQUENCE SET; Schema: operativo; Owner: -
--

SELECT pg_catalog.setval('operativo.study_results_id_seq', 1, false);


--
-- Name: doctors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.doctors_id_seq', 1, false);


--
-- Name: patients_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.patients_id_seq', 1, false);


--
-- Name: service_order_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.service_order_items_id_seq', 1, false);


--
-- Name: service_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.service_orders_id_seq', 1, false);


--
-- Name: studies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.studies_id_seq', 1, false);


--
-- Name: study_details_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.study_details_id_seq', 1, false);


--
-- Name: study_result_values_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.study_result_values_id_seq', 1, false);


--
-- Name: study_results_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.study_results_id_seq', 1, false);


--
-- Name: user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_id_seq', 2, true);


--
-- Name: user_login_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_login_logs_id_seq', 8, true);


--
-- Name: user_session PK_adf3b49590842ac3cf54cac451a; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.user_session
    ADD CONSTRAINT "PK_adf3b49590842ac3cf54cac451a" PRIMARY KEY (id);


--
-- Name: user_login_logs PK_bcad8136a91a5fdba07ea1284f7; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.user_login_logs
    ADD CONSTRAINT "PK_bcad8136a91a5fdba07ea1284f7" PRIMARY KEY (id);


--
-- Name: user PK_cace4a159ff9f2512dd42373760; Type: CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin."user"
    ADD CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY (id);


--
-- Name: study_details PK_5f322566a8074b855918418abfc; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_details
    ADD CONSTRAINT "PK_5f322566a8074b855918418abfc" PRIMARY KEY (id);


--
-- Name: service_order_items PK_6f33fec247bbbd740b40886b962; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.service_order_items
    ADD CONSTRAINT "PK_6f33fec247bbbd740b40886b962" PRIMARY KEY (id);


--
-- Name: doctors PK_8207e7889b50ee3695c2b8154ff; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.doctors
    ADD CONSTRAINT "PK_8207e7889b50ee3695c2b8154ff" PRIMARY KEY (id);


--
-- Name: service_orders PK_914aa74962ee83b10614ea2095d; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.service_orders
    ADD CONSTRAINT "PK_914aa74962ee83b10614ea2095d" PRIMARY KEY (id);


--
-- Name: patients PK_a7f0b9fcbb3469d5ec0b0aceaa7; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.patients
    ADD CONSTRAINT "PK_a7f0b9fcbb3469d5ec0b0aceaa7" PRIMARY KEY (id);


--
-- Name: studies PK_b100ff0c4a0ad02a9c2270d45b6; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.studies
    ADD CONSTRAINT "PK_b100ff0c4a0ad02a9c2270d45b6" PRIMARY KEY (id);


--
-- Name: study_results PK_bf5d53356b03af9ae3083ba7113; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_results
    ADD CONSTRAINT "PK_bf5d53356b03af9ae3083ba7113" PRIMARY KEY (id);


--
-- Name: study_result_values PK_de02c2e6a0b34dd7ab6cdb361c4; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_result_values
    ADD CONSTRAINT "PK_de02c2e6a0b34dd7ab6cdb361c4" PRIMARY KEY (id);


--
-- Name: studies UQ_70bc3802c9dc98aa38a6422cb69; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.studies
    ADD CONSTRAINT "UQ_70bc3802c9dc98aa38a6422cb69" UNIQUE (code);


--
-- Name: doctors UQ_764e04456946abd3fbd4155421e; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.doctors
    ADD CONSTRAINT "UQ_764e04456946abd3fbd4155421e" UNIQUE ("licenseNumber");


--
-- Name: service_orders UQ_ee8acede046a925fbb00ff0053c; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.service_orders
    ADD CONSTRAINT "UQ_ee8acede046a925fbb00ff0053c" UNIQUE (folio);


--
-- Name: patients UQ_f3fdfcd4c9943fbbd77c26c942a; Type: CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.patients
    ADD CONSTRAINT "UQ_f3fdfcd4c9943fbbd77c26c942a" UNIQUE ("documentType", "documentNumber");


--
-- Name: study_details PK_5f322566a8074b855918418abfc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_details
    ADD CONSTRAINT "PK_5f322566a8074b855918418abfc" PRIMARY KEY (id);


--
-- Name: service_order_items PK_6f33fec247bbbd740b40886b962; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_items
    ADD CONSTRAINT "PK_6f33fec247bbbd740b40886b962" PRIMARY KEY (id);


--
-- Name: doctors PK_8207e7889b50ee3695c2b8154ff; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT "PK_8207e7889b50ee3695c2b8154ff" PRIMARY KEY (id);


--
-- Name: service_orders PK_914aa74962ee83b10614ea2095d; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT "PK_914aa74962ee83b10614ea2095d" PRIMARY KEY (id);


--
-- Name: patients PK_a7f0b9fcbb3469d5ec0b0aceaa7; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT "PK_a7f0b9fcbb3469d5ec0b0aceaa7" PRIMARY KEY (id);


--
-- Name: user_session PK_adf3b49590842ac3cf54cac451a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT "PK_adf3b49590842ac3cf54cac451a" PRIMARY KEY (id);


--
-- Name: studies PK_b100ff0c4a0ad02a9c2270d45b6; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT "PK_b100ff0c4a0ad02a9c2270d45b6" PRIMARY KEY (id);


--
-- Name: user_login_logs PK_bcad8136a91a5fdba07ea1284f7; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_login_logs
    ADD CONSTRAINT "PK_bcad8136a91a5fdba07ea1284f7" PRIMARY KEY (id);


--
-- Name: study_results PK_bf5d53356b03af9ae3083ba7113; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_results
    ADD CONSTRAINT "PK_bf5d53356b03af9ae3083ba7113" PRIMARY KEY (id);


--
-- Name: user PK_cace4a159ff9f2512dd42373760; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY (id);


--
-- Name: study_result_values PK_de02c2e6a0b34dd7ab6cdb361c4; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_result_values
    ADD CONSTRAINT "PK_de02c2e6a0b34dd7ab6cdb361c4" PRIMARY KEY (id);


--
-- Name: studies UQ_70bc3802c9dc98aa38a6422cb69; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studies
    ADD CONSTRAINT "UQ_70bc3802c9dc98aa38a6422cb69" UNIQUE (code);


--
-- Name: doctors UQ_764e04456946abd3fbd4155421e; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT "UQ_764e04456946abd3fbd4155421e" UNIQUE ("licenseNumber");


--
-- Name: service_orders UQ_ee8acede046a925fbb00ff0053c; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT "UQ_ee8acede046a925fbb00ff0053c" UNIQUE (folio);


--
-- Name: patients UQ_f3fdfcd4c9943fbbd77c26c942a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT "UQ_f3fdfcd4c9943fbbd77c26c942a" UNIQUE ("documentType", "documentNumber");


--
-- Name: IDX_e12875dfb3b1d92d7d7c5377e2; Type: INDEX; Schema: admin; Owner: -
--

CREATE UNIQUE INDEX "IDX_e12875dfb3b1d92d7d7c5377e2" ON admin."user" USING btree (email);


--
-- Name: idx_doctors_email; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_doctors_email ON operativo.doctors USING btree (email);


--
-- Name: idx_doctors_name; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_doctors_name ON operativo.doctors USING btree ("firstName");


--
-- Name: idx_doctors_phone; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_doctors_phone ON operativo.doctors USING btree (phone);


--
-- Name: idx_patients_email; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_patients_email ON operativo.patients USING btree (email);


--
-- Name: idx_patients_name; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_patients_name ON operativo.patients USING btree ("firstName");


--
-- Name: idx_patients_phone; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_patients_phone ON operativo.patients USING btree (phone);


--
-- Name: idx_service_order_created_at; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_service_order_created_at ON operativo.service_orders USING btree ("createdAt");


--
-- Name: idx_service_order_doctor; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_service_order_doctor ON operativo.service_orders USING btree (doctor_id);


--
-- Name: idx_service_order_patient; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_service_order_patient ON operativo.service_orders USING btree (patient_id);


--
-- Name: idx_service_order_status; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_service_order_status ON operativo.service_orders USING btree (status);


--
-- Name: idx_services_folio; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_services_folio ON operativo.service_orders USING btree (folio);


--
-- Name: idx_studies_code; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_studies_code ON operativo.studies USING btree (code);


--
-- Name: idx_studies_name; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_studies_name ON operativo.studies USING btree (name);


--
-- Name: idx_study_results_active; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_study_results_active ON operativo.study_results USING btree ("isActive");


--
-- Name: idx_study_results_service_item; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_study_results_service_item ON operativo.study_results USING btree (service_order_item_id);


--
-- Name: idx_study_results_service_order; Type: INDEX; Schema: operativo; Owner: -
--

CREATE INDEX idx_study_results_service_order ON operativo.study_results USING btree (service_order_id);


--
-- Name: IDX_e12875dfb3b1d92d7d7c5377e2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IDX_e12875dfb3b1d92d7d7c5377e2" ON public."user" USING btree (email);


--
-- Name: idx_doctors_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doctors_email ON public.doctors USING btree (email);


--
-- Name: idx_doctors_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doctors_name ON public.doctors USING btree ("firstName");


--
-- Name: idx_doctors_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doctors_phone ON public.doctors USING btree (phone);


--
-- Name: idx_patients_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_email ON public.patients USING btree (email);


--
-- Name: idx_patients_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_name ON public.patients USING btree ("firstName");


--
-- Name: idx_patients_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patients_phone ON public.patients USING btree (phone);


--
-- Name: idx_service_order_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_order_created_at ON public.service_orders USING btree ("createdAt");


--
-- Name: idx_service_order_doctor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_order_doctor ON public.service_orders USING btree (doctor_id);


--
-- Name: idx_service_order_patient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_order_patient ON public.service_orders USING btree (patient_id);


--
-- Name: idx_service_order_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_order_status ON public.service_orders USING btree (status);


--
-- Name: idx_services_folio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_folio ON public.service_orders USING btree (folio);


--
-- Name: idx_studies_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studies_code ON public.studies USING btree (code);


--
-- Name: idx_studies_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_studies_name ON public.studies USING btree (name);


--
-- Name: idx_study_results_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_results_active ON public.study_results USING btree ("isActive");


--
-- Name: idx_study_results_service_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_results_service_item ON public.study_results USING btree (service_order_item_id);


--
-- Name: idx_study_results_service_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_study_results_service_order ON public.study_results USING btree (service_order_id);


--
-- Name: user_session FK_b5eb7aa08382591e7c2d1244fe5; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.user_session
    ADD CONSTRAINT "FK_b5eb7aa08382591e7c2d1244fe5" FOREIGN KEY ("userId") REFERENCES admin."user"(id) ON DELETE CASCADE;


--
-- Name: user_login_logs FK_f8379df7d627c940c12d301485a; Type: FK CONSTRAINT; Schema: admin; Owner: -
--

ALTER TABLE ONLY admin.user_login_logs
    ADD CONSTRAINT "FK_f8379df7d627c940c12d301485a" FOREIGN KEY (user_id) REFERENCES admin."user"(id) ON DELETE SET NULL;


--
-- Name: study_results FK_00e15e46e4afaf45af47fb1d25d; Type: FK CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_results
    ADD CONSTRAINT "FK_00e15e46e4afaf45af47fb1d25d" FOREIGN KEY (service_order_id) REFERENCES operativo.service_orders(id) ON DELETE CASCADE;


--
-- Name: study_result_values FK_190fc95b150ec44782150d7be45; Type: FK CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_result_values
    ADD CONSTRAINT "FK_190fc95b150ec44782150d7be45" FOREIGN KEY (study_detail_id) REFERENCES operativo.study_details(id);


--
-- Name: service_orders FK_22a87b10ec2a5b9d939e61768e9; Type: FK CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.service_orders
    ADD CONSTRAINT "FK_22a87b10ec2a5b9d939e61768e9" FOREIGN KEY (doctor_id) REFERENCES operativo.doctors(id);


--
-- Name: study_details FK_4fcee6d26193d680407c100a154; Type: FK CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_details
    ADD CONSTRAINT "FK_4fcee6d26193d680407c100a154" FOREIGN KEY (parent_id) REFERENCES operativo.study_details(id) ON DELETE CASCADE;


--
-- Name: study_result_values FK_70d9dc177a06103a92f5b158924; Type: FK CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_result_values
    ADD CONSTRAINT "FK_70d9dc177a06103a92f5b158924" FOREIGN KEY (study_result_id) REFERENCES operativo.study_results(id) ON DELETE CASCADE;


--
-- Name: service_orders FK_8b0f7b334fb34a74c789ccd018f; Type: FK CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.service_orders
    ADD CONSTRAINT "FK_8b0f7b334fb34a74c789ccd018f" FOREIGN KEY (patient_id) REFERENCES operativo.patients(id);


--
-- Name: study_results FK_9770dae08724b3fc59e83b203ec; Type: FK CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_results
    ADD CONSTRAINT "FK_9770dae08724b3fc59e83b203ec" FOREIGN KEY (service_order_item_id) REFERENCES operativo.service_order_items(id) ON DELETE CASCADE;


--
-- Name: study_details FK_ce74d5d770e39ad0f6f30a78052; Type: FK CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.study_details
    ADD CONSTRAINT "FK_ce74d5d770e39ad0f6f30a78052" FOREIGN KEY (study_id) REFERENCES operativo.studies(id) ON DELETE CASCADE;


--
-- Name: service_order_items FK_e4472d1d912bb7be07fe4eeed27; Type: FK CONSTRAINT; Schema: operativo; Owner: -
--

ALTER TABLE ONLY operativo.service_order_items
    ADD CONSTRAINT "FK_e4472d1d912bb7be07fe4eeed27" FOREIGN KEY (service_order_id) REFERENCES operativo.service_orders(id) ON DELETE CASCADE;


--
-- Name: study_results FK_00e15e46e4afaf45af47fb1d25d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_results
    ADD CONSTRAINT "FK_00e15e46e4afaf45af47fb1d25d" FOREIGN KEY (service_order_id) REFERENCES operativo.service_orders(id) ON DELETE CASCADE;


--
-- Name: study_result_values FK_190fc95b150ec44782150d7be45; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_result_values
    ADD CONSTRAINT "FK_190fc95b150ec44782150d7be45" FOREIGN KEY (study_detail_id) REFERENCES operativo.study_details(id);


--
-- Name: service_orders FK_22a87b10ec2a5b9d939e61768e9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT "FK_22a87b10ec2a5b9d939e61768e9" FOREIGN KEY (doctor_id) REFERENCES operativo.doctors(id);


--
-- Name: study_details FK_4fcee6d26193d680407c100a154; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_details
    ADD CONSTRAINT "FK_4fcee6d26193d680407c100a154" FOREIGN KEY (parent_id) REFERENCES public.study_details(id) ON DELETE CASCADE;


--
-- Name: study_result_values FK_70d9dc177a06103a92f5b158924; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_result_values
    ADD CONSTRAINT "FK_70d9dc177a06103a92f5b158924" FOREIGN KEY (study_result_id) REFERENCES public.study_results(id) ON DELETE CASCADE;


--
-- Name: service_orders FK_8b0f7b334fb34a74c789ccd018f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT "FK_8b0f7b334fb34a74c789ccd018f" FOREIGN KEY (patient_id) REFERENCES public.patients(id);


--
-- Name: study_results FK_9770dae08724b3fc59e83b203ec; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_results
    ADD CONSTRAINT "FK_9770dae08724b3fc59e83b203ec" FOREIGN KEY (service_order_item_id) REFERENCES operativo.service_order_items(id) ON DELETE CASCADE;


--
-- Name: user_session FK_b5eb7aa08382591e7c2d1244fe5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT "FK_b5eb7aa08382591e7c2d1244fe5" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: study_details FK_ce74d5d770e39ad0f6f30a78052; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_details
    ADD CONSTRAINT "FK_ce74d5d770e39ad0f6f30a78052" FOREIGN KEY (study_id) REFERENCES public.studies(id) ON DELETE CASCADE;


--
-- Name: service_order_items FK_e4472d1d912bb7be07fe4eeed27; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_order_items
    ADD CONSTRAINT "FK_e4472d1d912bb7be07fe4eeed27" FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id) ON DELETE CASCADE;


--
-- Name: user_login_logs FK_f8379df7d627c940c12d301485a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_login_logs
    ADD CONSTRAINT "FK_f8379df7d627c940c12d301485a" FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict EqSFPSSVQbUCCB0Ep5iUaeXAUPHWs3dwnrq0dD6RPe03qfe5jviHjTAFfduRNUv

